import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import type { Db } from "mongodb";
import type { BuildInfo } from "./build-info.js";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { createAlertDispatcher, ensureAlertIndexes } from "./alerts.js";
import { ensureSessionIndexes, registerAuth } from "./auth.js";
import { registerDashboard } from "./dashboard.js";
import { createDownChecker } from "./down-checker.js";
import {
  ensureHeartbeatIndexes,
  registerHeartbeatIntake,
} from "./heartbeats.js";
import { ensureIncidentIndexes } from "./incidents.js";
import { ensureLinkedChatIndexes } from "./linked-chats.js";
import { registerLayout } from "./layout.js";
import { MonitorLock } from "./monitor-lock.js";
import { registerMonitorManagement } from "./monitor-management.js";
import { ensureMonitorIndexes, registerMonitors } from "./monitors.js";
import { registerSettings } from "./settings.js";
import { ensureStatePeriodIndexes } from "./state-periods.js";
import type { TelegramClient } from "./telegram.js";
import { registerTelegramBot } from "./telegram-bot.js";
import { ensureUserIndexes } from "./users.js";

export interface AppDeps {
  db: Db;
  clock: Clock;
  telegram: TelegramClient;
  config: Config;
  /** Version and commit reported by `/health`. */
  build: BuildInfo;
  /** Fastify's logger: true for the default one, or options. Off by default. */
  logger?: FastifyServerOptions["logger"];
}

declare module "fastify" {
  interface FastifyInstance {
    /** Runs one round of background work (Down checker, Alert dispatcher). Called every 10 s by main. */
    tick(): Promise<void>;
  }
}

export type App = FastifyInstance;

/** Composition root: builds the Fastify instance and every module. */
export async function createApp(deps: AppDeps): Promise<App> {
  const { db, clock, config } = deps;
  // Startup grace: no Monitor goes Down before this + its Interval + Grace period.
  const startedAt = clock.now();
  const lock = new MonitorLock();
  const app = Fastify({
    logger: deps.logger ?? false,
    // Exactly one proxy (the edge Caddy, ADR 0004) sits in front; the client IP is the last X-Forwarded-For hop it adds.
    trustProxy: (_address, hop) => hop === 0,
  });

  await Promise.all([
    ensureUserIndexes(db),
    ensureSessionIndexes(db),
    ensureMonitorIndexes(db),
    ensureHeartbeatIndexes(db),
    ensureIncidentIndexes(db),
    ensureLinkedChatIndexes(db),
    ensureStatePeriodIndexes(db),
    ensureAlertIndexes(db),
  ]);

  await app.register(cookie);
  await app.register(formbody);
  const auth = registerAuth(app, { db, clock, config });
  registerLayout(app, { auth, build: deps.build });
  registerDashboard(app, { db, clock });
  registerMonitors(app, { db, clock, config, auth });
  registerMonitorManagement(app, { db, clock, auth, lock });
  await registerHeartbeatIntake(app, { db, clock, lock });
  registerSettings(app, { db, clock, auth });
  registerTelegramBot(app, { db, clock, telegram: deps.telegram, config });

  app.get("/health", async (_req, reply) => {
    try {
      await db.command({ ping: 1 });
      return reply.send({ status: "ok", ...deps.build });
    } catch {
      return reply
        .code(503)
        .send({ status: "mongo unavailable", ...deps.build });
    }
  });

  const checkDeadlines = createDownChecker({ db, clock, startedAt, lock });
  const dispatchAlerts = createAlertDispatcher({
    db,
    clock,
    telegram: deps.telegram,
    log: app.log,
  });
  const tick = async (): Promise<void> => {
    await checkDeadlines();
    await dispatchAlerts();
  };

  app.decorate("tick", tick);
  return app;
}
