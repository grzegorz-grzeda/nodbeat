import { describe, expect, it } from "vitest";
import { giveComp } from "../src/plans.js";
import {
  buildTestApp,
  createUser,
  login,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;
const EMAIL = "me@example.com";
const PASSWORD = "correct horse";

/** A Pro User (Pro for one more day) with a Linked chat and a Webhook, Plans on. */
async function proUser() {
  const ctx = await buildTestApp({ plansEnabled: true });
  await createUser(ctx.db, { email: EMAIL, password: PASSWORD });
  await ctx.db.collection("users").updateOne(
    { email: EMAIL },
    {
      $set: {
        plan: {
          proUntil: new Date(ctx.clock.now().getTime() + DAY),
          source: "comp",
          proEndedAt: null,
        },
      },
    },
  );
  const browser = await login(ctx.app, EMAIL, PASSWORD);
  await linkChat(ctx, browser);
  const hook = await browser.submit("/settings", "/settings/webhooks", {
    name: "Hook",
    url: "https://hooks.example.com/nodbeat",
    secret: "",
  });
  expect(hook.statusCode).toBe(303);
  return { ...ctx, browser };
}

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
        chat: { id: 1001, type: "private", first_name: "Me" },
        date: 0,
        text: `/start ${code}`,
      },
    },
  });
  ctx.telegram.sent.length = 0;
}

const telegramTexts = (ctx: TestContext) =>
  ctx.telegram.sent.map((m) => m.text.replace(/<[^>]*>/g, ""));
const webhookBodies = (ctx: TestContext) =>
  ctx.http.requests.map((r) => JSON.parse(r.body) as Record<string, unknown>);

const clear = (ctx: TestContext) => {
  ctx.telegram.sent.length = 0;
  ctx.http.requests.length = 0;
};

describe("Pro ended", () => {
  it("sends a notice to every Alert channel and shows a banner, once", async () => {
    const ctx = await proUser();
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(0);

    ctx.clock.advance(DAY);
    await ctx.app.tick();
    expect(telegramTexts(ctx)).toEqual([
      expect.stringContaining("Your nodbeat Pro has ended"),
    ]);
    expect(telegramTexts(ctx)[0]).toContain("keep working until 2026-01-16");
    expect(webhookBodies(ctx)).toEqual([
      expect.objectContaining({ kind: "notice" }),
    ]);
    const user = await ctx.db.collection("users").findOne({ email: EMAIL });
    expect(user!.plan.proEndedAt).toEqual(ctx.clock.now());

    clear(ctx);
    ctx.clock.advance(60 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(0);

    const page = (await ctx.browser.get("/")).body;
    expect(page).toContain('class="banner"');
    expect(page).toContain("Your Pro has ended.");
    const dismiss = await ctx.browser.submit("/", "/plan/banner/dismiss", {
      back: "/settings",
    });
    expect(dismiss.headers.location).toBe("/settings");
    expect((await ctx.browser.get("/")).body).not.toContain('class="banner"');
  });

  it("sends a second notice on day 12 and shows the banner again", async () => {
    const ctx = await proUser();
    ctx.clock.advance(DAY);
    await ctx.app.tick();
    await ctx.browser.submit("/", "/plan/banner/dismiss", { back: "/" });
    clear(ctx);

    ctx.clock.advance(11 * DAY);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(0);
    ctx.clock.advance(DAY);
    await ctx.app.tick();
    expect(telegramTexts(ctx)).toEqual([
      expect.stringContaining("nodbeat Pro features stop on 2026-01-16"),
    ]);
    expect((await ctx.browser.get("/")).body).toContain('class="banner"');

    clear(ctx);
    ctx.clock.advance(DAY);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(0);
    // Past the 14 days the banner is gone (the dormant step is issue 0064).
    ctx.clock.advance(2 * DAY);
    expect((await ctx.browser.get("/")).body).not.toContain('class="banner"');
  });

  it("keeps Webhooks and over-limit Monitors alerting while Pro features last", async () => {
    const ctx = await proUser();
    const pages: string[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await ctx.browser.submit("/monitors/new", "/monitors", {
        name: `M${i}`,
        interval: "60",
        intervalUnit: "s",
        grace: "30",
        graceUnit: "s",
      });
      expect(res.statusCode).toBe(303);
      pages.push(res.headers.location as string);
    }
    ctx.clock.advance(DAY);
    await ctx.app.tick();
    clear(ctx);

    const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(
      (await ctx.browser.get(pages[10]!)).body,
    )![1]!;
    await ctx.app.inject({ method: "GET", url: hb });
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(telegramTexts(ctx)).toEqual([
      expect.stringContaining("M10 is Down"),
    ]);
    expect(webhookBodies(ctx)).toEqual([
      expect.objectContaining({ kind: "down" }),
    ]);
  });

  it("does nothing for a User never on Pro", async () => {
    const ctx = await buildTestApp({ plansEnabled: true });
    await createUser(ctx.db, { email: EMAIL, password: PASSWORD });
    const browser = await login(ctx.app, EMAIL, PASSWORD);
    await linkChat(ctx, browser);
    ctx.clock.advance(DAY);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toHaveLength(0);
    expect((await browser.get("/")).body).not.toContain('class="banner"');
  });

  it("puts Pro-only features to sleep on day 14, and Pro again wakes Webhooks", async () => {
    const ctx = await proUser();
    const created = await ctx.browser.submit("/monitors/new", "/monitors", {
      name: "Fast",
      interval: "30",
      intervalUnit: "s",
      grace: "10",
      graceUnit: "s",
      reminderEvery: "3600",
    });
    expect(created.statusCode).toBe(303);
    const page = created.headers.location as string;
    const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(
      (await ctx.browser.get(page)).body,
    )![1]!;
    const monitor = () =>
      ctx.db.collection("monitors").findOne({ name: "Fast" });

    ctx.clock.advance(DAY);
    await ctx.app.tick();
    ctx.clock.advance(13 * DAY);
    await ctx.app.tick();
    expect((await monitor())!.intervalSec).toBe(30);
    expect((await ctx.browser.get("/settings")).body).not.toContain(
      "Needs Pro</span>",
    );

    ctx.clock.advance(DAY);
    await ctx.app.tick();
    expect((await monitor())!.intervalSec).toBe(60);
    expect((await monitor())!.reminderEverySec).toBeNull();
    expect((await ctx.browser.get("/settings")).body).toContain(
      "Needs Pro</span>",
    );
    const user = await ctx.db.collection("users").findOne({ email: EMAIL });
    expect(user!.plan.dormantAt).toEqual(ctx.clock.now());

    // A Down Alert goes to the Linked chat only: the Webhook sleeps, and the Alert isn't kept for it.
    await ctx.app.inject({ method: "GET", url: hb });
    clear(ctx);
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(telegramTexts(ctx)).toEqual([
      expect.stringContaining("Fast is Down"),
    ]);
    expect(ctx.http.requests).toHaveLength(0);
    expect(await ctx.db.collection("alertOutbox").countDocuments()).toBe(0);

    // Runs once.
    ctx.clock.advance(DAY);
    await ctx.app.tick();
    expect(
      (await ctx.db.collection("users").findOne({ email: EMAIL }))!.plan
        .dormantAt,
    ).toEqual(user!.plan.dormantAt);

    await giveComp(
      ctx.db,
      user!._id,
      new Date(ctx.clock.now().getTime() + 30 * DAY),
    );
    clear(ctx);
    await ctx.app.inject({ method: "GET", url: hb });
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(webhookBodies(ctx).map((b) => b.kind)).toEqual(["up", "down"]);
    expect((await ctx.browser.get("/settings")).body).not.toContain(
      "Needs Pro</span>",
    );
    expect((await monitor())!.reminderEverySec).toBeNull();
    expect((await monitor())!.intervalSec).toBe(60);
  });
});
