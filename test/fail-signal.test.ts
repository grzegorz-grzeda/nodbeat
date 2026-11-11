import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  stateOf,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const PRIVATE_CHAT = { id: 1001, type: "private", first_name: "Grzegorz" };

let updateId = 0;

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

/** Links a Telegram chat the way a User does: Link code + `/start <code>`. */
async function linkChat(ctx: TestContext, browser: Browser) {
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
      message: {
        message_id: updateId,
        chat: PRIVATE_CHAT,
        date: 0,
        text: `/start ${code}`,
      },
    },
  });
  ctx.telegram.sent.length = 0;
}

/** Creates a Monitor (Interval 60 s, Grace period 30 s) and returns its page path and Heartbeat path. */
async function createMonitor(
  browser: Browser,
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Nightly backup",
    interval: "60",
    intervalUnit: "s",
    grace: "30",
    graceUnit: "s",
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

/** An Alert's text as the chat shows it: Telegram HTML tags dropped. */
const shown = (text: string) => text.replace(/<[^>]*>/g, "");

describe("Fail signal", () => {
  it("makes an Up Monitor Down with a Down Alert that says it reported a failure; a Heartbeat brings it Up", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: m.hb });
    ctx.clock.advance(10 * SEC);

    const res = await ctx.app.inject({
      method: "GET",
      url: `${m.hb}/fail?msg=disk%20full`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.body).toBe("OK");
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect(ctx.telegram.sent).toHaveLength(1);
    const down = shown(ctx.telegram.sent[0]!.text).split("\n");
    expect(down[0]).toBe("🔴 Nightly backup reported a failure");
    expect(down).toContain("Message: disk full");

    ctx.clock.advance(20 * SEC);
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Up");
    expect(ctx.telegram.sent).toHaveLength(2);
    expect(shown(ctx.telegram.sent[1]!.text)).toContain(
      "is Up again\nAt 2026-01-01 01:00:30 (Europe/Warsaw), after 20 s Down",
    );
  });

  it("takes the message from a POST body", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);

    const res = await ctx.app.inject({
      method: "POST",
      url: `${m.hb}/fail`,
      payload: "exit code 3",
    });
    expect(res.statusCode).toBe(200);
    await ctx.app.tick();

    expect(shown(ctx.telegram.sent[0]!.text)).toContain("Message: exit code 3");
  });

  it("makes a New Monitor Down", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);

    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail` });
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect(ctx.telegram.sent).toHaveLength(1);
    const lines = shown(ctx.telegram.sent[0]!.text).split("\n");
    expect(lines[0]).toBe("🔴 Nightly backup reported a failure");
    expect(lines.some((l) => l.startsWith("Message:"))).toBe(false);
  });

  it("sends no second Alert to a Down Monitor, and the Interval deadline opens no second Incident", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail?msg=first` });
    await ctx.app.tick();

    ctx.clock.advance(60 * SEC);
    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail?msg=again` });
    ctx.clock.advance(120 * SEC);
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect(ctx.telegram.sent).toHaveLength(1);
    const incidents = (await ctx.browser.get(`${m.page}/incidents`)).body;
    expect(incidents.match(/ongoing/g)).toHaveLength(1);
  });

  it("only records a Fail signal to a Paused Monitor", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.browser.submit(m.page, `${m.page}/pause`);

    const res = await ctx.app.inject({ method: "GET", url: `${m.hb}/fail` });
    expect(res.statusCode).toBe(200);
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, m.page)).toBe("Paused");
    expect(ctx.telegram.sent).toEqual([]);
  });

  it("sends no Alert for a Monitor with Alerts off", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    await ctx.browser.submit(m.page, `${m.page}/alerts`, {
      alertsEnabled: "false",
    });
    await ctx.app.inject({ method: "GET", url: m.hb });

    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail` });
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect(ctx.telegram.sent).toEqual([]);
  });

  it("keeps the rate limit per signal kind: Fail then success in a second pass, two Fails get 429", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    const hit = (url: string) => ctx.app.inject({ method: "GET", url });

    expect((await hit(`${m.hb}/fail`)).statusCode).toBe(200);
    expect((await hit(m.hb)).statusCode).toBe(200);
    ctx.clock.advance(500);
    const flood = await hit(`${m.hb}/fail`);
    expect(flood.statusCode).toBe(429);
    expect(flood.headers["content-type"]).toMatch(/^text\/plain/);
    ctx.clock.advance(500);
    expect((await hit(`${m.hb}/fail`)).statusCode).toBe(200);
  });

  it("answers 404 to HEAD and to an unknown token", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);

    const head = await ctx.app.inject({ method: "HEAD", url: `${m.hb}/fail` });
    expect(head.statusCode).toBe(404);
    const unknown = await ctx.app.inject({
      method: "GET",
      url: "/hb/nope/fail",
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.body).toBe("Not Found");
    expect(await stateOf(ctx.browser, m.page)).toBe("New");
  });

  it("shows each Heartbeat's signal in the Heartbeats log", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: `${m.hb}?msg=fine` });
    ctx.clock.advance(SEC);
    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail?msg=broken` });

    const log = (await ctx.browser.get(`${m.page}/heartbeats`)).body;
    expect(log).toContain("<th>Signal</th>");
    const rows = [...log.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .slice(1)
      .map((r) =>
        [...r[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]!.trim()),
      );
    expect(rows.map((r) => [r[1], r[2]])).toEqual([
      ["Fail", "broken"],
      ["✓", "fine"],
    ]);
  });
});
