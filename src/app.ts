import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { ensureSessionIndexes, registerAuth } from "./auth.js";
import { registerDashboard } from "./dashboard.js";
import { createDownChecker } from "./down-checker.js";
import {
  ensureHeartbeatIndexes,
  registerHeartbeatIntake,
} from "./heartbeats.js";
import { ensureIncidentIndexes } from "./incidents.js";
import { ensureLinkedChatIndexes } from "./linked-chats.js";
import { MonitorLock } from "./monitor-lock.js";
import { registerMonitorManagement } from "./monitor-management.js";
import { ensureMonitorIndexes, registerMonitors } from "./monitors.js";
import { ensurePausePeriodIndexes } from "./pause-periods.js";
import { registerSettings } from "./settings.js";
import type { TelegramClient } from "./telegram.js";
import { registerTelegramBot } from "./telegram-bot.js";
import { ensureUserIndexes } from "./users.js";

export interface AppDeps {
  db: Db;
  clock: Clock;
  telegram: TelegramClient;
  config: Config;
  /** Enables Fastify's request logger. Off by default (tests). */
  logger?: boolean;
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
    ensurePausePeriodIndexes(db),
  ]);

  await app.register(cookie);
  await app.register(formbody);
  const auth = registerAuth(app, { db, clock, config });
  registerDashboard(app, { db, clock, auth });
  registerMonitors(app, { db, clock, config, auth });
  registerMonitorManagement(app, { db, clock, auth, lock });
  await registerHeartbeatIntake(app, { db, clock, lock });
  registerSettings(app, { db, clock, auth });
  registerTelegramBot(app, { db, clock, telegram: deps.telegram, config });

  app.get("/health", async (_req, reply) => {
    try {
      await db.command({ ping: 1 });
      return reply.type("text/plain").send("ok");
    } catch {
      return reply.code(503).type("text/plain").send("mongo unavailable");
    }
  });

  const checkDeadlines = createDownChecker({ db, clock, startedAt, lock });
  const tick = async (): Promise<void> => {
    await checkDeadlines();
  };

  app.decorate("tick", tick);
  return app;
}
