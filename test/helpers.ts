import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { MongoClient, type Db } from "mongodb";
import { afterEach, inject } from "vitest";
import { createApp, type App } from "../src/app.js";
import { runCli } from "../src/cli.js";
import type { BuildInfo } from "../src/build-info.js";
import type { Clock } from "../src/clock.js";
import type { Config } from "../src/config.js";
import type { HttpClient, HttpRequest } from "../src/outbound-http.js";
import {
  TelegramChatMigratedError,
  TelegramForbiddenError,
  type ChatMemberStatus,
  type SendMessageOptions,
  type BotCommand,
  type UpdateType,
  type TelegramClient,
} from "../src/telegram.js";

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
  options: SendMessageOptions;
}

const memberKey = (chatId: number, userId: number) => `${chatId}:${userId}`;

export class RecordingTelegram implements TelegramClient {
  readonly sent: SentMessage[] = [];
  /** Every send fails. */
  failing = false;
  /** Sends to these chats fail, e.g. a group the bot was removed from. */
  readonly failingChats = new Set<number>();

  /** Sends to these chats fail with HTTP 403: the bot was blocked or removed. */
  readonly forbiddenChats = new Set<number>();

  /** Sends to these chats fail with HTTP 400 and the new id: the group was upgraded to a supergroup. */
  readonly migratedChats = new Map<number, number>();

  /** Runs before every send, e.g. to make an Update arrive while an Alert is being sent. */
  beforeSend: ((chatId: number) => Promise<void>) | null = null;

  async sendMessage(
    chatId: number,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<void> {
    await this.beforeSend?.(chatId);
    const newChatId = this.migratedChats.get(chatId);
    if (newChatId !== undefined) {
      throw new TelegramChatMigratedError("sendMessage", newChatId);
    }
    if (this.forbiddenChats.has(chatId)) {
      throw new TelegramForbiddenError("sendMessage");
    }
    if (this.failing || this.failingChats.has(chatId)) {
      throw new Error("telegram unavailable");
    }
    this.sent.push({ chatId, text, options });
  }

  readonly #memberStatuses = new Map<string, ChatMemberStatus>();

  /** `getChatMember` fails for every user in these chats, e.g. Telegram is down. */
  readonly failingMemberChats = new Set<number>();

  /** What `getChatMember` answers for this user in this chat; "member" unless set. */
  setChatMemberStatus(
    chatId: number,
    userId: number,
    status: ChatMemberStatus,
  ): void {
    this.#memberStatuses.set(memberKey(chatId, userId), status);
  }

  async getChatMember(
    chatId: number,
    userId: number,
  ): Promise<ChatMemberStatus> {
    if (this.failingMemberChats.has(chatId)) {
      throw new Error("telegram unavailable");
    }
    return this.#memberStatuses.get(memberKey(chatId, userId)) ?? "member";
  }

  readonly webhooks: Array<{
    url: string;
    secretToken: string;
    allowedUpdates: UpdateType[];
  }> = [];

  async setWebhook(
    url: string,
    secretToken: string,
    allowedUpdates: UpdateType[],
  ): Promise<void> {
    if (this.failingSetup) throw new Error("telegram unavailable");
    this.webhooks.push({ url, secretToken, allowedUpdates });
  }

  /** `setWebhook` and `setMyCommands` fail, e.g. Telegram is down at startup. */
  failingSetup = false;

  readonly commandMenus: BotCommand[][] = [];

  async setMyCommands(commands: BotCommand[]): Promise<void> {
    if (this.failingSetup) throw new Error("telegram unavailable");
    this.commandMenus.push(commands);
  }
}

/** A host no test names resolves to this public address. */
export const PUBLIC_IP = "93.184.216.34";

/**
 * Records outgoing HTTP requests (Webhooks, ntfy topics) instead of sending them, and resolves host names from
 * `hosts`. Kind-agnostic: every HTTP Alert channel goes through it.
 */
export class RecordingHttp implements HttpClient {
  readonly requests: HttpRequest[] = [];
  /** The status code answered, or an error thrown (a timeout, a refused connection). 200 unless set. */
  respond: (request: HttpRequest) => number | Error = () => 200;
  /** Addresses a host name resolves to; any other name resolves to PUBLIC_IP. */
  readonly hosts = new Map<string, string[]>();

  async post(request: HttpRequest): Promise<{ status: number }> {
    const answer = this.respond(request);
    if (answer instanceof Error) throw answer;
    this.requests.push(request);
    return { status: answer };
  }

  readonly resolve = async (hostname: string): Promise<string[]> =>
    isIP(hostname) ? [hostname] : (this.hosts.get(hostname) ?? [PUBLIC_IP]);
}

export const testConfig: Config = {
  mongoUri: "mongodb://unused-in-tests",
  publicBaseUrl: "https://nodbeat.test",
  sessionSecret: "test-session-secret-at-least-32-chars!!",
  telegramBotToken: "123:test-token",
  telegramWebhookSecret: "test-webhook-secret",
  selfHeartbeatUrl: undefined,
  trustedProxyIp: "172.18.0.2",
  legalDir: undefined,
};

/** The Content-Security-Policy sent on every response. */
export const CSP =
  "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** Fixed build info so tests can assert on it. */
export const testBuild: BuildInfo = { version: "1.2.3", commit: "abc1234" };

export interface TestContext {
  app: App;
  clock: FakeClock;
  telegram: RecordingTelegram;
  http: RecordingHttp;
  client: MongoClient;
  db: Db;
  /** Warnings and errors the app logged, parsed. */
  logs: Array<Record<string, unknown>>;
  config: Config;
}

/** Fastify logger options that collect warnings and errors into `logs`. */
const recordingLogger = (logs: TestContext["logs"], level = "warn") => ({
  level,
  stream: {
    write: (line: string) => {
      logs.push(JSON.parse(line) as Record<string, unknown>);
    },
  },
});

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/**
 * Builds the full app on a fresh, isolated database. `logLevel` "info" also records request logs; `legalDir` is
 * `LEGAL_DIR` (a fixture directory: the repo holds no real legal text).
 */
export async function buildTestApp(
  options: { logLevel?: "warn" | "info"; legalDir?: string } = {},
): Promise<TestContext> {
  const client = new MongoClient(inject("mongoUri"));
  await client.connect();
  const db = client.db(`test_${randomUUID().replaceAll("-", "")}`);
  const clock = new FakeClock();
  const telegram = new RecordingTelegram();
  const http = new RecordingHttp();
  const logs: TestContext["logs"] = [];
  const config: Config = { ...testConfig, legalDir: options.legalDir };
  const app = await createApp({
    db,
    clock,
    telegram,
    http,
    resolveHost: http.resolve,
    config,
    build: testBuild,
    logger: recordingLogger(logs, options.logLevel),
  }).catch(async (err: unknown) => {
    // e.g. malformed legal files: don't leak the connection.
    await client.close();
    throw err;
  });
  cleanups.push(async () => {
    await app.close();
    await client.close();
  });
  return { app, clock, telegram, http, client, db, logs, config };
}

/** Simulates a nodbeat restart: a fresh `createApp` on the same database and clock. */
export async function restartApp(ctx: TestContext): Promise<App> {
  await ctx.app.close();
  const app = await createApp({
    db: ctx.db,
    clock: ctx.clock,
    telegram: ctx.telegram,
    http: ctx.http,
    resolveHost: ctx.http.resolve,
    config: ctx.config,
    build: testBuild,
    logger: recordingLogger(ctx.logs),
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

/** The CSRF token of the first form in this page, if any. */
export const csrfTokenIn = (body: string): string | undefined =>
  /name="_csrf" value="([^"]+)"/.exec(body)?.[1];

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
    fields: Record<string, string | string[]> = {},
    options: { csrf?: string | null; headers?: Record<string, string> } = {},
  ): Promise<InjectResponse> {
    if (options.csrf === undefined) await this.get(formPage);
    const csrf = options.csrf === undefined ? this.#csrf : options.csrf;
    // An array is sent as the field repeated, like checkboxes of the same name.
    const form = new URLSearchParams(
      Object.entries(fields).flatMap(([k, v]) =>
        (Array.isArray(v) ? v : [v]).map((value): [string, string] => [
          k,
          value,
        ]),
      ),
    );
    if (csrf !== null && csrf !== undefined) form.set("_csrf", csrf);
    return this.#send({
      method: "POST",
      url: action,
      headers: {
        ...options.headers,
        "content-type": "application/x-www-form-urlencoded",
      },
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
    const token = csrfTokenIn(res.body);
    if (token) this.#csrf = token;
    this.lastResponse = res;
    return res;
  }
}

/** The state badge's label (`Up`, `Down`, ...) on a Monitor page. */
export const stateOf = async (
  browser: Browser,
  page: string,
): Promise<string | undefined> =>
  /class="badge badge-\w+">(\w+)<\/span>/.exec(
    (await browser.get(page)).body,
  )?.[1];

export async function login(
  app: App,
  email: string,
  password: string,
  browser = new Browser(app),
): Promise<Browser> {
  await browser.submit("/login", "/login", { email, password });
  return browser;
}
