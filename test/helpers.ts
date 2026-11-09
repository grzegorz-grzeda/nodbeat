import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { afterEach, inject } from "vitest";
import { createApp, type App } from "../src/app.js";
import type { Clock } from "../src/clock.js";
import type { Config } from "../src/config.js";
import type { TelegramClient } from "../src/telegram.js";

export class FakeClock implements Clock {
  #now: Date;

  constructor(start = new Date("2026-01-01T00:00:00Z")) {
    this.#now = start;
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}

export interface SentMessage {
  chatId: number;
  text: string;
}

export class RecordingTelegram implements TelegramClient {
  readonly sent: SentMessage[] = [];
  failing = false;

  async sendMessage(chatId: number, text: string): Promise<void> {
    if (this.failing) throw new Error("telegram unavailable");
    this.sent.push({ chatId, text });
  }

  async setWebhook(): Promise<void> {}
}

export const testConfig: Config = {
  mongoUri: "mongodb://unused-in-tests",
  publicBaseUrl: "https://nodbeat.test",
  sessionSecret: "test-session-secret-at-least-32-chars!!",
  telegramBotToken: "123:test-token",
  telegramWebhookSecret: "test-webhook-secret",
  selfHeartbeatUrl: undefined,
};

export interface TestContext {
  app: App;
  clock: FakeClock;
  telegram: RecordingTelegram;
  client: MongoClient;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Builds the full app on a fresh, isolated database. */
export async function buildTestApp(): Promise<TestContext> {
  const client = new MongoClient(inject("mongoUri"));
  await client.connect();
  const db = client.db(`test_${randomUUID().replaceAll("-", "")}`);
  const clock = new FakeClock();
  const telegram = new RecordingTelegram();
  const app = await createApp({ db, clock, telegram, config: testConfig });
  cleanups.push(async () => {
    await app.close();
    await client.close();
  });
  return { app, clock, telegram, client };
}
