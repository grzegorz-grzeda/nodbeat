import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { loadBuildInfo } from "./build-info.js";
import { systemClock } from "./clock.js";
import { ConfigError, loadConfig } from "./config.js";
import { createNodeHttpClient, dnsResolver } from "./outbound-http.js";
import { startSelfHeartbeat } from "./self-heartbeat.js";
import { createHttpTelegramClient } from "./telegram.js";

const TICK_INTERVAL_MS = 10_000;
const PORT = 3000;
const MONGO_SERVER_SELECTION_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const config = loadConfig();

  const client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS,
  });
  await client.connect();

  const app = await createApp({
    db: client.db(),
    clock: systemClock,
    telegram: createHttpTelegramClient(config.telegramBotToken),
    http: createNodeHttpClient(),
    resolveHost: dnsResolver,
    config,
    build: loadBuildInfo(),
    logger: true,
  });

  let ticking = false;
  const timer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    app
      .tick()
      .catch((err: unknown) => app.log.error({ err }, "tick failed"))
      .finally(() => {
        ticking = false;
      });
  }, TICK_INTERVAL_MS);

  const stopSelfHeartbeat = config.selfHeartbeatUrl
    ? startSelfHeartbeat({ url: config.selfHeartbeatUrl, log: app.log })
    : () => {};

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    clearInterval(timer);
    stopSelfHeartbeat();
    await app.close();
    await client.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: PORT });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
});
