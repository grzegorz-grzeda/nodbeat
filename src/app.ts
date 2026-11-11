import { createHmac } from "node:crypto";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import type { Db } from "mongodb";
import type { BuildInfo } from "./build-info.js";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { registerAdmin } from "./admin.js";
import {
  ensureAlertChannelIndexes,
  migrateLinkedChats,
} from "./alert-channels.js";
import {
  createAlertDispatcher,
  ensureAlertIndexes,
  migrateAlertOutbox,
  type AlertSenders,
} from "./alerts.js";
import { ensureSessionIndexes, registerAuth } from "./auth.js";
import { registerDashboard } from "./dashboard.js";
import { ensureInviteIndexes, registerInvites } from "./invites.js";
import { registerDocs } from "./docs.js";
import { registerErrorPages } from "./error-page.js";
import { createDownChecker } from "./down-checker.js";
import {
  ensureHeartbeatIndexes,
  registerHeartbeatIntake,
} from "./heartbeats.js";
import { ensureIncidentIndexes } from "./incidents.js";
import { ensureLinkCodeIndexes } from "./linked-chats.js";
import { registerLayout } from "./layout.js";
import { createLogPruner } from "./log-pruner.js";
import { KeyedLock } from "./keyed-lock.js";
import { registerMonitorLogs } from "./monitor-logs.js";
import { registerMonitorManagement } from "./monitor-management.js";
import { ensureMonitorIndexes, registerMonitors } from "./monitors.js";
import { registerOpenApi } from "./openapi.js";
import { registerSecurityHeaders } from "./security-headers.js";
import { registerSettings } from "./settings.js";
import { ensureStatePeriodIndexes } from "./state-periods.js";
import type { TelegramClient } from "./telegram.js";
import { registerTelegramBot } from "./telegram-bot.js";
import { createTelegramSender } from "./telegram-sender.js";
import type { HostResolver, HttpClient } from "./outbound-http.js";
import { createWebhookSender } from "./webhook-sender.js";
import { ensureUserIndexes } from "./users.js";

export interface AppDeps {
  db: Db;
  clock: Clock;
  telegram: TelegramClient;
  /** Sends HTTP Alert channels' requests (Webhooks). */
  http: HttpClient;
  /** Resolves the hosts of Alert channel URLs for the SSRF guard. */
  resolveHost: HostResolver;
  config: Config;
  /** Version and commit reported by `/health`. */
  build: BuildInfo;
  /** Fastify's logger: true for the default one, or options. Off by default. */
  logger?: FastifyServerOptions["logger"];
}

declare module "fastify" {
  interface FastifyInstance {
    /** Runs one round of background work (Down checker, Alert dispatcher, log pruning). Called every 10 s by main. */
    tick(): Promise<void>;
  }
}

export type App = FastifyInstance;

/** Hides the secret path segment of Heartbeat URLs and Invite links: whoever reads the logs mustn't get either. */
export function redactSecretPath(url: string): string {
  return url.replace(/^\/(hb|invite)\/[^/?#]+/, "/$1/<redacted>");
}

/** The logger options with request URLs redacted; `false` stays off. */
function withRedactedUrls(
  logger: FastifyServerOptions["logger"],
): NonNullable<FastifyServerOptions["logger"]> {
  if (!logger) return false;
  return {
    ...(logger === true ? {} : logger),
    serializers: {
      ...(logger === true ? {} : logger.serializers),
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: redactSecretPath(req.url),
        host: req.host,
        remoteAddress: req.ip,
      }),
    },
  };
}

/** Composition root: builds the Fastify instance and every module. */
export async function createApp(deps: AppDeps): Promise<App> {
  const { db, clock, config } = deps;
  // Startup grace: no Monitor goes Down before this + its Interval + Grace period.
  const startedAt = clock.now();
  const lock = new KeyedLock();
  // Keyed by owner: it guards the per-User Alert channel limit, whichever kind is added.
  const channelLock = new KeyedLock();
  const pruner = createLogPruner({ db, clock });
  const options: FastifyServerOptions = {
    logger: withRedactedUrls(deps.logger),
    // Only the edge Caddy (ADR 0004), at its fixed address, may set the client IP via X-Forwarded-For;
    // another container on the edge network can't fake one.
    trustProxy: config.trustedProxyIp,
  };
  const app = Fastify(options);

  registerSecurityHeaders(app);

  await Promise.all([
    ensureUserIndexes(db),
    ensureSessionIndexes(db),
    ensureMonitorIndexes(db),
    ensureHeartbeatIndexes(db),
    ensureIncidentIndexes(db),
    ensureLinkCodeIndexes(db),
    ensureAlertChannelIndexes(db),
    ensureStatePeriodIndexes(db),
    ensureAlertIndexes(db),
    ensureInviteIndexes(db),
  ]);
  // Linked chats and queued Alerts from before Alert channels existed; idempotent.
  await migrateLinkedChats(db);
  await migrateAlertOutbox(db);

  // Signs Flash cookies. A key derived for that purpose alone, so a signature never doubles as a CSRF token.
  await app.register(cookie, {
    secret: createHmac("sha256", config.sessionSecret)
      .update("flash-cookie")
      .digest("base64url"),
  });
  await app.register(formbody);
  const auth = registerAuth(app, { db, clock, config });
  registerLayout(app, { auth, build: deps.build });
  registerErrorPages(app);
  registerDashboard(app, { db, clock, config });
  registerMonitors(app, { db, clock, config, auth });
  registerMonitorManagement(app, {
    db,
    clock,
    auth,
    lock,
    publicBaseUrl: config.publicBaseUrl,
  });
  registerMonitorLogs(app, { db, clock });
  await registerHeartbeatIntake(app, {
    db,
    clock,
    lock,
    pruner,
    publicBaseUrl: config.publicBaseUrl,
  });
  const senders: AlertSenders = {
    telegram: createTelegramSender({
      db,
      telegram: deps.telegram,
      log: app.log,
    }),
    webhook: createWebhookSender({
      http: deps.http,
      resolveHost: deps.resolveHost,
    }),
  };
  registerSettings(app, {
    db,
    clock,
    auth,
    senders,
    channelLock,
    resolveHost: deps.resolveHost,
    publicBaseUrl: config.publicBaseUrl,
  });
  registerAdmin(app, { db, clock });
  registerInvites(app, { db, clock, config, auth });
  registerTelegramBot(app, {
    db,
    clock,
    telegram: deps.telegram,
    config,
    channelLock,
  });
  registerOpenApi(app, {
    build: deps.build,
    publicBaseUrl: config.publicBaseUrl,
  });
  registerDocs(app, { build: deps.build });

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

  const checkDeadlines = createDownChecker({
    db,
    clock,
    startedAt,
    lock,
    pruner,
    publicBaseUrl: config.publicBaseUrl,
  });
  const dispatchAlerts = createAlertDispatcher({
    db,
    clock,
    senders,
    log: app.log,
  });
  const tick = async (): Promise<void> => {
    await checkDeadlines();
    await dispatchAlerts();
    await pruner.prune();
  };

  app.decorate("tick", tick);
  return app;
}
