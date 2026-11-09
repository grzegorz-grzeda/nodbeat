import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import type { TelegramClient } from "./telegram.js";

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
  const { db } = deps;
  const app = Fastify({ logger: deps.logger ?? false });

  app.get("/health", async (_req, reply) => {
    try {
      await db.command({ ping: 1 });
      return reply.type("text/plain").send("ok");
    } catch {
      return reply.code(503).type("text/plain").send("mongo unavailable");
    }
  });

  const tick = async (): Promise<void> => {};

  app.decorate("tick", tick);
  return app;
}
