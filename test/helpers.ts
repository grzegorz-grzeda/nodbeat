import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { afterEach, inject } from "vitest";
import { createApp, type App } from "../src/app.js";
import { runCli } from "../src/cli.js";
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

  readonly webhooks: Array<{ url: string; secretToken: string }> = [];

  async setWebhook(url: string, secretToken: string): Promise<void> {
    this.webhooks.push({ url, secretToken });
  }
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
  db: Db;
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
  return { app, clock, telegram, client, db };
}

/** Simulates a nodbeat restart: a fresh `createApp` on the same database and clock. */
export async function restartApp(ctx: TestContext): Promise<App> {
  await ctx.app.close();
  const app = await createApp({
    db: ctx.db,
    clock: ctx.clock,
    telegram: ctx.telegram,
    config: testConfig,
  });
  cleanups.push(() => app.close());
  return app;
}

/** Creates a User the way the Admin does: through the CLI command. */
export async function createUser(
  db: Db,
  user: { email: string; password: string; admin?: boolean; timeZone?: string },
): Promise<{ exitCode: number; output: string }> {
  const args = ["create-user", "--email", user.email];
  if (user.admin) args.push("--admin");
  if (user.timeZone) args.push("--time-zone", user.timeZone);
  let output = "";
  const exitCode = await runCli(args, {
    db,
    readPassword: async () => user.password,
    write: (text) => {
      output += text;
    },
  });
  return { exitCode, output };
}

type InjectResponse = Awaited<ReturnType<App["inject"]>>;

/** A cookie-keeping client that fills in CSRF tokens from the last page it saw. */
export class Browser {
  readonly cookies = new Map<string, string>();
  lastResponse!: InjectResponse;
  #csrf: string | undefined;

  constructor(
    readonly app: App,
    readonly ip = "203.0.113.1",
    /** Sent with every request, e.g. the X-Forwarded-For the edge Caddy adds. */
    readonly extraHeaders: Record<string, string> = {},
  ) {}

  async get(url: string): Promise<InjectResponse> {
    return this.#send({ method: "GET", url });
  }

  /** Posts a form. Fetches `formPage` first to pick up its CSRF token unless `csrf` is given. */
  async submit(
    formPage: string,
    action: string,
    fields: Record<string, string> = {},
    options: { csrf?: string | null } = {},
  ): Promise<InjectResponse> {
    if (options.csrf === undefined) await this.get(formPage);
    const csrf = options.csrf === undefined ? this.#csrf : options.csrf;
    const form = new URLSearchParams(fields);
    if (csrf !== null && csrf !== undefined) form.set("_csrf", csrf);
    return this.#send({
      method: "POST",
      url: action,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: form.toString(),
    });
  }

  async #send(request: {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    payload?: string;
  }): Promise<InjectResponse> {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await this.app.inject({
      ...request,
      headers: {
        ...this.extraHeaders,
        ...request.headers,
        ...(cookie ? { cookie } : {}),
      },
      remoteAddress: this.ip,
    });
    for (const c of res.cookies) {
      const expired =
        c.value === "" || (c.expires !== undefined && c.expires <= new Date(0));
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    const token = /name="_csrf" value="([^"]+)"/.exec(res.body)?.[1];
    if (token) this.#csrf = token;
    this.lastResponse = res;
    return res;
  }
}

export async function login(
  app: App,
  email: string,
  password: string,
  browser = new Browser(app),
): Promise<Browser> {
  await browser.submit("/login", "/login", { email, password });
  return browser;
}
