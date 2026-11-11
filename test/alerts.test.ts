import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  restartApp,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const MIN = 60 * SEC;
const PRIVATE_CHAT = { id: 1001, type: "private", first_name: "Grzegorz" };
const GROUP_CHAT = { id: -2002, type: "group", title: "Garden project" };

type Chat = { id: number; type: string; title?: string; first_name?: string };

let updateId = 0;

async function loggedIn(
  options: { email?: string; timeZone?: string } = {},
  ctx?: TestContext,
) {
  const base = ctx ?? (await buildTestApp());
  const email = options.email ?? "me@example.com";
  await createUser(base.db, {
    email,
    password: "correct horse",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const browser = await login(base.app, email, "correct horse");
  return { ...base, browser };
}

/** Links a Telegram chat to the logged-in User the way a User does: Link code + `/start <code>`. */
async function linkChat(ctx: TestContext, browser: Browser, chat: Chat) {
  const res = await browser.submit("/settings", "/settings/link-code");
  const settings = await browser.get(res.headers.location as string);
  const code = /<code class="link-code">([A-Z0-9]{8})<\/code>/.exec(
    settings.body,
  )![1]!;
  await ctx.app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: {
      "x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
    },
    payload: {
      update_id: ++updateId,
      message: { message_id: updateId, chat, date: 0, text: `/start ${code}` },
    },
  });
  ctx.telegram.sent.length = 0;
}

/** Creates a Monitor and returns its page path and Heartbeat path. */
async function createMonitor(
  browser: Browser,
  name = "Garden sensor",
  intervalSec = 60,
  graceSec = 30,
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name,
    interval: String(intervalSec),
    intervalUnit: "s",
    grace: String(graceSec),
    graceUnit: "s",
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

const sendHeartbeat = (ctx: TestContext, hb: string) =>
  ctx.app.inject({ method: "GET", url: hb });

/** Sends the first Heartbeat, then lets the Monitor go Down (deadline at +90 s). */
async function goDown(ctx: TestContext, hb: string) {
  await sendHeartbeat(ctx, hb);
  ctx.clock.advance(91 * SEC);
  await ctx.app.tick();
}

/** An Alert's text as the chat shows it: Telegram HTML tags dropped. */
const shown = (text: string) => text.replace(/<[^>]*>/g, "");

const firstLines = (ctx: TestContext) =>
  ctx.telegram.sent.map((s) => shown(s.text).split("\n")[0]);

describe("Alerts", () => {
  it("sends a Down Alert to every Linked chat, then an Up Alert with the Incident duration", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const m = await createMonitor(ctx.browser);

    // 2026-01-01T00:00:00Z; the deadline is 00:01:30 UTC = 01:01:30 in Europe/Warsaw.
    await goDown(ctx, m.hb);
    expect(ctx.telegram.sent.map((s) => s.chatId).sort()).toEqual([
      GROUP_CHAT.id,
      PRIVATE_CHAT.id,
    ]);
    for (const s of ctx.telegram.sent) {
      expect(shown(s.text)).toContain("Garden sensor is Down");
      expect(s.text).toContain("2026-01-01 01:01:30");
    }
    ctx.telegram.sent.length = 0;

    ctx.clock.advance(30 * SEC);
    await sendHeartbeat(ctx, m.hb);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(2);
    for (const s of ctx.telegram.sent) {
      expect(shown(s.text)).toContain("Garden sensor is Up");
      expect(s.text).toContain("31 s");
      expect(s.text).toContain("2026-01-01 01:02:01");
    }
  });

  it("shows times in the owner's time zone", async () => {
    const ctx = await loggedIn({ timeZone: "America/New_York" });
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);

    await goDown(ctx, m.hb);

    expect(ctx.telegram.sent).toHaveLength(1);
    expect(ctx.telegram.sent[0]!.text).toContain("2025-12-31 19:01:30");
  });

  it("sends only to the owner's Linked chats", async () => {
    const ctx = await loggedIn();
    const other = await loggedIn({ email: "other@example.com" }, ctx);
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, other.browser, GROUP_CHAT);
    const m = await createMonitor(ctx.browser);

    await goDown(ctx, m.hb);

    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([PRIVATE_CHAT.id]);
  });

  it("sends no Alert when a New Monitor gets its first Heartbeat", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);

    await sendHeartbeat(ctx, m.hb);
    await ctx.app.tick();

    expect(ctx.telegram.sent).toEqual([]);
  });

  it("sends no Alerts for a Monitor with Alerts off", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    await ctx.browser.submit(m.page, `${m.page}/alerts`, {
      alertsEnabled: "false",
    });

    await goDown(ctx, m.hb);
    ctx.clock.advance(30 * SEC);
    await sendHeartbeat(ctx, m.hb);
    await ctx.app.tick();

    expect(ctx.telegram.sent).toEqual([]);
  });

  it("sends no Up Alert when pausing closes the Incident", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    ctx.telegram.sent.length = 0;

    await ctx.browser.submit(m.page, `${m.page}/pause`);
    await ctx.app.tick();

    expect(ctx.telegram.sent).toEqual([]);
  });

  it("retries a failed send with exponential backoff", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failing = true;
    await goDown(ctx, m.hb); // first attempt fails; next one 30 s later
    ctx.telegram.failing = false;

    ctx.clock.advance(20 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toEqual([]);

    ctx.clock.advance(10 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(1);
    expect(ctx.telegram.sent[0]!.text).toContain("is Down");

    ctx.clock.advance(10 * MIN);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(1);
  });

  it("backs off further after each failure", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failing = true;
    await goDown(ctx, m.hb); // fails at 0; retries due at +30 s, +90 s, +210 s
    ctx.clock.advance(30 * SEC);
    await ctx.app.tick(); // fails at +30 s
    ctx.telegram.failing = false;

    ctx.clock.advance(50 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toEqual([]);

    ctx.clock.advance(10 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(1);
  });

  it("gives up after 1 hour of failures and logs the dropped Alert", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failing = true;
    await goDown(ctx, m.hb);

    for (let elapsed = 0; elapsed < 60 * MIN; elapsed += 10 * SEC) {
      ctx.clock.advance(10 * SEC);
      await ctx.app.tick();
    }
    expect(ctx.logs).toContainEqual(
      expect.objectContaining({
        msg: expect.stringContaining("Alert dropped"),
      }),
    );

    ctx.telegram.failing = false;
    ctx.clock.advance(10 * MIN);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toEqual([]);
  });

  it("retries only the chats that failed", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failingChats.add(GROUP_CHAT.id);

    await goDown(ctx, m.hb);
    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([PRIVATE_CHAT.id]);

    ctx.telegram.failingChats.clear();
    ctx.clock.advance(30 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([
      PRIVATE_CHAT.id,
      GROUP_CHAT.id,
    ]);
  });

  it("unlinks a chat that blocked or removed the bot (HTTP 403) and still delivers to the other chats", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const other = await loggedIn({ email: "other@example.com" }, ctx);
    await linkChat(ctx, other.browser, GROUP_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.forbiddenChats.add(GROUP_CHAT.id);

    await goDown(ctx, m.hb);
    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([PRIVATE_CHAT.id]);
    expect(ctx.logs).toContainEqual(
      expect.objectContaining({ chatId: GROUP_CHAT.id }),
    );
    // Every Link of the chat is gone, not just the Alert owner's.
    for (const browser of [ctx.browser, other.browser]) {
      expect((await browser.get("/settings")).body).not.toContain(
        "Garden project",
      );
    }

    ctx.telegram.forbiddenChats.clear();
    ctx.clock.advance(10 * MIN);
    await ctx.app.tick();
    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([PRIVATE_CHAT.id]);
  });

  it("delivers a Monitor's Alerts in order", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb); // t=91 s: first Down delivered

    ctx.telegram.failing = true;
    ctx.clock.advance(9 * SEC); // t=100 s
    await sendHeartbeat(ctx, m.hb);
    await ctx.app.tick(); // Up fails; retry due at 130 s
    ctx.clock.advance(30 * SEC); // t=130 s
    await ctx.app.tick(); // Up fails; retry due at 190 s
    ctx.clock.advance(60 * SEC); // t=190 s
    await ctx.app.tick(); // second Down enqueued; Up fails, retry due at 310 s

    ctx.telegram.failing = false;
    ctx.clock.advance(40 * SEC); // t=230 s: the second Down waits behind the Up
    await ctx.app.tick();
    expect(firstLines(ctx)).toEqual(["🔴 Garden sensor is Down"]);

    ctx.clock.advance(80 * SEC); // t=310 s
    await ctx.app.tick();
    expect(firstLines(ctx)).toEqual([
      "🔴 Garden sensor is Down",
      "🟢 Garden sensor is Up again",
      "🔴 Garden sensor is Down",
    ]);
  });

  it("does not hold back another Monitor's Alerts while one is being retried", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const garden = await createMonitor(ctx.browser);
    const other = await createMonitor(ctx.browser, "Other");
    await sendHeartbeat(ctx, garden.hb); // t=0: Down at 90 s
    ctx.clock.advance(5 * SEC);
    await sendHeartbeat(ctx, other.hb); // t=5 s: Down at 95 s

    ctx.telegram.failing = true;
    ctx.clock.advance(86 * SEC); // t=91 s
    await ctx.app.tick(); // Garden's Down fails; retry due at 121 s
    ctx.telegram.failing = false;

    ctx.clock.advance(5 * SEC); // t=96 s
    await ctx.app.tick();
    expect(firstLines(ctx)).toEqual(["🔴 Other is Down"]);

    ctx.clock.advance(25 * SEC); // t=121 s
    await ctx.app.tick();
    expect(firstLines(ctx)).toEqual([
      "🔴 Other is Down",
      "🔴 Garden sensor is Down",
    ]);
  });

  it("drops a Down Alert still pending when its Incident closes and sends only the Up Alert", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failing = true;
    await goDown(ctx, m.hb);
    ctx.telegram.failing = false;

    ctx.clock.advance(10 * SEC);
    await sendHeartbeat(ctx, m.hb);
    await ctx.app.tick();

    expect(ctx.telegram.sent).toHaveLength(1);
    expect(shown(ctx.telegram.sent[0]!.text)).toContain(
      "Garden sensor is Up again",
    );
    expect(ctx.telegram.sent[0]!.text).toContain("11 s Down");
  });

  it("keeps pending Alerts across a restart", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failing = true;
    await goDown(ctx, m.hb);
    ctx.telegram.failing = false;

    const app = await restartApp(ctx);
    ctx.clock.advance(30 * SEC);
    await app.tick();

    expect(ctx.telegram.sent).toHaveLength(1);
    expect(shown(ctx.telegram.sent[0]!.text)).toContain(
      "Garden sensor is Down",
    );
  });

  it("drops a deleted Monitor's pending Alerts", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser);
    ctx.telegram.failing = true;
    await goDown(ctx, m.hb);
    ctx.telegram.failing = false;

    await ctx.browser.submit(`${m.page}/delete`, `${m.page}/delete`);
    ctx.clock.advance(30 * SEC);
    await ctx.app.tick();

    expect(ctx.telegram.sent).toEqual([]);
  });

  describe("Alert text", () => {
    it("sends a Down Alert in Telegram HTML with the bold name, the last Heartbeat message and a link", async () => {
      const ctx = await loggedIn();
      await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
      const m = await createMonitor(ctx.browser);
      await ctx.app.inject({
        method: "GET",
        url: `${m.hb}?msg=battery%203.1V`,
      });
      ctx.clock.advance(91 * SEC);
      await ctx.app.tick();

      expect(ctx.telegram.sent).toHaveLength(1);
      const [down] = ctx.telegram.sent;
      expect(down!.options).toEqual({ parseMode: "HTML" });
      expect(down!.text).toBe(
        "🔴 <b>Garden sensor</b> is Down\n" +
          "Since 2026-01-01 01:01:30 (Europe/Warsaw)\n" +
          "Last message: battery 3.1V\n" +
          `<a href="https://nodbeat.test${m.page}">Open Monitor</a>`,
      );
    });

    it("leaves the message line out of a Down Alert when the last Heartbeat had none", async () => {
      const ctx = await loggedIn();
      await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
      const m = await createMonitor(ctx.browser);
      await goDown(ctx, m.hb);

      expect(ctx.telegram.sent[0]!.text).not.toContain("Last message");
    });

    it("sends an Up Alert in Telegram HTML with the bold name, the Down duration and a link", async () => {
      const ctx = await loggedIn();
      await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
      const m = await createMonitor(ctx.browser);
      await goDown(ctx, m.hb);
      ctx.telegram.sent.length = 0;
      ctx.clock.advance(30 * SEC);
      await ctx.app.inject({ method: "GET", url: `${m.hb}?msg=back` });
      await ctx.app.tick();

      expect(ctx.telegram.sent).toHaveLength(1);
      const [up] = ctx.telegram.sent;
      expect(up!.options).toEqual({ parseMode: "HTML" });
      expect(up!.text).toBe(
        "🟢 <b>Garden sensor</b> is Up again\n" +
          "At 2026-01-01 01:02:01 (Europe/Warsaw), after 31 s Down\n" +
          `<a href="https://nodbeat.test${m.page}">Open Monitor</a>`,
      );
    });

    it("escapes the Monitor name and the Heartbeat message for Telegram HTML", async () => {
      const ctx = await loggedIn();
      await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
      const m = await createMonitor(ctx.browser, "<b>&co</b>");
      await ctx.app.inject({
        method: "GET",
        url: `${m.hb}?msg=${encodeURIComponent("v < 3 & t > 40")}`,
      });
      ctx.clock.advance(91 * SEC);
      await ctx.app.tick();

      const text = ctx.telegram.sent[0]!.text;
      expect(text).toContain("🔴 <b>&lt;b&gt;&amp;co&lt;/b&gt;</b> is Down");
      expect(text).toContain("Last message: v &lt; 3 &amp; t &gt; 40");
    });

    it("keeps the text built when the Alert was enqueued", async () => {
      const ctx = await loggedIn();
      await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
      const m = await createMonitor(ctx.browser);
      ctx.telegram.failing = true;
      await goDown(ctx, m.hb);
      ctx.telegram.failing = false;
      await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
        name: "Renamed",
        interval: "60",
        intervalUnit: "s",
        grace: "30",
        graceUnit: "s",
      });

      ctx.clock.advance(30 * SEC);
      await ctx.app.tick();

      expect(ctx.telegram.sent).toHaveLength(1);
      expect(ctx.telegram.sent[0]!.text).toContain("<b>Garden sensor</b>");
    });

    it("sends bot command replies as plain text", async () => {
      const ctx = await loggedIn();
      await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
      await ctx.app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers: {
          "x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
        },
        payload: {
          update_id: ++updateId,
          message: {
            message_id: updateId,
            chat: PRIVATE_CHAT,
            date: 0,
            text: "/status",
          },
        },
      });

      expect(ctx.telegram.sent).toHaveLength(1);
      expect(ctx.telegram.sent[0]!.options).toEqual({});
    });
  });
});
