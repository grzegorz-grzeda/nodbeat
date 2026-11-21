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

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  await linkChat(ctx, browser);
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
      update_id: 1,
      message: {
        message_id: 1,
        chat: PRIVATE_CHAT,
        date: 0,
        text: `/start ${code}`,
      },
    },
  });
  ctx.telegram.sent.length = 0;
}

/** Creates a Monitor (Interval 60 s, Grace period 30 s) and returns its page, id and Heartbeat path. */
async function createMonitor(browser: Browser, name: string, parentId = "") {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name,
    interval: "60",
    intervalUnit: "s",
    grace: "30",
    graceUnit: "s",
    parentId,
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, id: page.split("/").pop()!, hb };
}

/** The Alerts sent so far, as their first line without tags. */
const alerts = (ctx: TestContext) =>
  ctx.telegram.sent.map((m) => m.text.replace(/<[^>]*>/g, "").split("\n")[0]);

/** A Router and a Pi behind it, both heard from, then both silent past their deadline. */
async function routerDown() {
  const ctx = await loggedIn();
  const router = await createMonitor(ctx.browser, "Router");
  const pi = await createMonitor(ctx.browser, "Pi", router.id);
  await ctx.app.inject({ method: "GET", url: router.hb });
  await ctx.app.inject({ method: "GET", url: pi.hb });
  ctx.clock.advance(91 * SEC);
  await ctx.app.tick();
  return { ...ctx, router, pi };
}

describe("Unreachable Children", () => {
  it("makes a silent Child Unreachable when its Parent goes Down, with one Alert", async () => {
    const ctx = await routerDown();
    expect(await stateOf(ctx.browser, ctx.router.page)).toBe("Down");
    expect(await stateOf(ctx.browser, ctx.pi.page)).toBe("Unreachable");
    expect(alerts(ctx)).toHaveLength(1);
    expect(alerts(ctx)[0]).toContain("Router");

    const page = (await ctx.browser.get(ctx.pi.page)).body;
    expect(page).toMatch(/class="state-note"[\s\S]*Router[\s\S]*Down/);
    expect(page).not.toContain("ongoing");

    const dashboard = (await ctx.browser.get("/")).body;
    expect(dashboard).toContain("badge-unreachable");
    expect(dashboard).toMatch(/class="state-note">\s*Router Down/);
  });

  it("brings the Child back Up quietly once the Parent is back", async () => {
    const ctx = await routerDown();
    await ctx.app.inject({ method: "GET", url: ctx.router.hb });
    await ctx.app.tick();
    await ctx.app.inject({ method: "GET", url: ctx.pi.hb });

    expect(await stateOf(ctx.browser, ctx.pi.page)).toBe("Up");
    // Router Down, Router Up: nothing about the Pi.
    expect(alerts(ctx)).toHaveLength(2);
    expect(alerts(ctx).join("\n")).not.toContain("Pi");
    const dashboard = (await ctx.browser.get("/")).body;
    // The Pi's Uptime is untouched; the Router's isn't.
    expect(dashboard.match(/100\.00%/g)).toHaveLength(1);
  });

  it("leaves Unreachable time out of the Child's Uptime", async () => {
    const ctx = await routerDown();
    ctx.clock.advance(3600 * SEC);
    await ctx.app.tick();
    const dashboard = (await ctx.browser.get("/")).body;
    // The Router lost most of its Uptime; the Pi none.
    expect(dashboard).toContain("100.00%");
  });

  it("makes the Child Down if it stays silent after the Parent is back", async () => {
    const ctx = await routerDown();
    await ctx.app.inject({ method: "GET", url: ctx.router.hb });
    await ctx.app.tick();
    ctx.clock.advance(89 * SEC);
    await ctx.app.inject({ method: "GET", url: ctx.router.hb });
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, ctx.pi.page)).toBe("Unreachable");

    ctx.clock.advance(2 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, ctx.pi.page)).toBe("Down");
    expect(alerts(ctx)).toHaveLength(3);
    expect(alerts(ctx)[2]).toContain("Pi");
  });

  it("gives the Child a fresh deadline when its Parent is Paused", async () => {
    const ctx = await routerDown();
    await ctx.browser.submit(ctx.router.page, `${ctx.router.page}/pause`);
    await ctx.app.tick();
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, ctx.pi.page)).toBe("Down");
  });

  it("makes an Unreachable Child Down at once on a Fail signal", async () => {
    const ctx = await routerDown();
    await ctx.app.inject({ method: "GET", url: `${ctx.pi.hb}/fail` });
    expect(await stateOf(ctx.browser, ctx.pi.page)).toBe("Down");
    await ctx.app.tick();
    expect(alerts(ctx)).toHaveLength(2);
    expect(alerts(ctx)[1]).toContain("Pi");
  });

  it("follows a chain: a grandchild behind an Unreachable Child is Unreachable too", async () => {
    const ctx = await loggedIn();
    const fibre = await createMonitor(ctx.browser, "Fibre");
    const router = await createMonitor(ctx.browser, "Router", fibre.id);
    const pi = await createMonitor(ctx.browser, "Pi", router.id);
    for (const m of [pi, router, fibre]) {
      await ctx.app.inject({ method: "GET", url: m.hb });
    }
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, fibre.page)).toBe("Down");
    expect(await stateOf(ctx.browser, router.page)).toBe("Unreachable");
    expect(await stateOf(ctx.browser, pi.page)).toBe("Unreachable");
    expect(alerts(ctx)).toHaveLength(1);
  });

  it("ignores a New Parent", async () => {
    const ctx = await loggedIn();
    const router = await createMonitor(ctx.browser, "Router");
    const pi = await createMonitor(ctx.browser, "Pi", router.id);
    await ctx.app.inject({ method: "GET", url: pi.hb });
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, router.page)).toBe("New");
    expect(await stateOf(ctx.browser, pi.page)).toBe("Down");
  });
});
