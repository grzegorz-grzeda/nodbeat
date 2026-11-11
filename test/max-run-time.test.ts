import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  restartApp,
  stateOf,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const MIN = 60 * SEC;
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

/** Creates a Monitor (Interval 1 h, Grace period 10 min) with the given Max run time (empty = none). */
async function createMonitor(
  browser: Browser,
  maxRunTime: string,
  maxRunTimeUnit = "m",
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Nightly backup",
    interval: "1",
    intervalUnit: "h",
    grace: "10",
    graceUnit: "m",
    maxRunTime,
    maxRunTimeUnit,
  });
  expect(res.statusCode).toBe(303);
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

/** An Alert's text as the chat shows it: Telegram HTML tags dropped. */
const shown = (text: string) => text.replace(/<[^>]*>/g, "");

/** The Incidents log's first row cells. */
async function firstIncident(browser: Browser, page: string) {
  const log = (await browser.get(`${page}/incidents`)).body;
  const row = [...log.matchAll(/<tr>([\s\S]*?)<\/tr>/g)][1]![1]!;
  return [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]!.trim());
}

describe("Max run time", () => {
  it("makes an Up Monitor Down with an Alert saying it ran longer, once a Run lasts past it", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser, "5");
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });

    ctx.clock.advance(5 * MIN - SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Up");

    ctx.clock.advance(SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect(ctx.telegram.sent).toHaveLength(1);
    const text = shown(ctx.telegram.sent[0]!.text);
    expect(text).toMatch(/^🔴 Nightly backup ran longer than 5 min\n/);
    expect(text).toContain("Since 2026-01-01 01:05:00");
  });

  it("stays Up when the Run succeeds before the Max run time", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser, "5");
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });
    ctx.clock.advance(4 * MIN);
    await ctx.app.inject({ method: "GET", url: m.hb });

    ctx.clock.advance(30 * MIN);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Up");
  });

  it("without a Max run time, only the Interval deadline applies", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser, "");
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });

    ctx.clock.advance(70 * MIN - SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Up");

    ctx.clock.advance(SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect(shown(ctx.telegram.sent[0]!.text)).toMatch(
      /^🔴 Nightly backup is Down\n/,
    );
  });

  it("after a restart during a Run, waits the startup grace before going Down", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser, "5");
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });
    ctx.clock.advance(4 * MIN);

    const app = await restartApp(ctx);
    const browser = await login(app, "me@example.com", "correct horse");
    ctx.clock.advance(5 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");

    ctx.clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
    expect((await firstIncident(browser, m.page))[0]).toContain(
      "2026-01-01 01:09:00",
    );
  });

  it("counts a shorter Max run time from the edit", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser, "30");
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });
    ctx.clock.advance(10 * MIN);

    const res = await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "Nightly backup",
      interval: "1",
      intervalUnit: "h",
      grace: "10",
      graceUnit: "m",
      maxRunTime: "5",
      maxRunTimeUnit: "m",
    });
    expect(res.statusCode).toBe(303);
    expect((await ctx.browser.get(m.page)).body).toContain(
      "Max run time: 5 min",
    );
    expect((await ctx.browser.get(`${m.page}/edit`)).body).toMatch(
      /name="maxRunTime"\s+value="5"/,
    );

    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Up");
    ctx.clock.advance(5 * MIN);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
  });

  it("rejects a Max run time out of bounds", async () => {
    const ctx = await loggedIn();
    for (const [value, unit] of [
      ["59", "s"],
      ["25", "h"],
      ["x", "m"],
    ]) {
      const res = await ctx.browser.submit("/monitors/new", "/monitors", {
        name: "Nightly backup",
        interval: "1",
        intervalUnit: "h",
        maxRunTime: value!,
        maxRunTimeUnit: unit!,
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("Max run time must be between 1 min and 1 d.");
    }
  });
});
