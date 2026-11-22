import { describe, expect, it } from "vitest";
import { monitors } from "../src/monitors.js";
import {
  buildTestApp,
  createUser,
  login,
  restartApp,
  type Browser,
  type TestContext,
} from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const EMAIL = "me@example.com";
const PASSWORD = "correct horse";

/** A User created on an instance with Plans on (after launch): Free. */
async function freeUser() {
  const ctx = await buildTestApp({ plansEnabled: true });
  await createUser(ctx.db, { email: EMAIL, password: PASSWORD });
  const browser = await login(ctx.app, EMAIL, PASSWORD);
  return { ...ctx, browser };
}

async function setPlan(ctx: TestContext, proUntil: Date | null) {
  await ctx.db
    .collection("users")
    .updateOne(
      { email: EMAIL },
      { $set: { plan: { proUntil, source: "comp", proEndedAt: null } } },
    );
}

const monitorFields = (extra: Record<string, string> = {}) => ({
  name: "Freezer",
  interval: "60",
  intervalUnit: "s",
  ...extra,
});

const createMonitor = (browser: Browser, extra: Record<string, string> = {}) =>
  browser.submit("/monitors/new", "/monitors", monitorFields(extra));

const addWebhook = (browser: Browser) =>
  browser.submit("/settings", "/settings/webhooks", {
    name: "Hook",
    url: "https://hooks.example.com/nodbeat",
    secret: "",
  });

describe("Plans off", () => {
  it("shows no Plan and keeps today's limits", async () => {
    const ctx = await buildTestApp();
    await createUser(ctx.db, { email: EMAIL, password: PASSWORD });
    const browser = await login(ctx.app, EMAIL, PASSWORD);
    expect((await browser.get("/settings")).body).not.toContain(
      "<h2>Plan</h2>",
    );
    const res = await createMonitor(browser, {
      interval: "30",
      reminderEvery: "3600",
    });
    expect(res.statusCode).toBe(303);
    expect((await addWebhook(browser)).statusCode).toBe(303);
  });
});

describe("Free Plan", () => {
  it("shows the Plan, its limits and usage in Settings", async () => {
    const { browser } = await freeUser();
    await createMonitor(browser);
    const body = (await browser.get("/settings")).body;
    expect(body).toContain("<h2>Plan</h2>");
    expect(body).toMatch(/<strong>Free<\/strong>/);
    expect(body).toContain("1 of 10 Monitors");
    expect(body).toContain("Shortest Interval: 1 min");
    expect(body).toMatch(/Webhooks: needs Pro/);
  });

  it("refuses an 11th Monitor with a Needs Pro message", async () => {
    const { browser, db } = await freeUser();
    for (let i = 0; i < 10; i++) {
      expect((await createMonitor(browser)).statusCode).toBe(303);
    }
    const res = await createMonitor(browser);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(
      "You can have at most 10 Monitors on Free. More need Pro.",
    );
    expect(await monitors(db).countDocuments()).toBe(10);
  });

  it("refuses a 30 s Interval, Reminders and a Webhook", async () => {
    const { browser } = await freeUser();
    const fast = await createMonitor(browser, { interval: "30" });
    expect(fast.statusCode).toBe(400);
    expect(fast.body).toContain("Intervals shorter than 1 min need Pro.");

    const reminders = await createMonitor(browser, { reminderEvery: "3600" });
    expect(reminders.statusCode).toBe(400);
    expect(reminders.body).toContain("Reminders need Pro.");

    const hook = await addWebhook(browser);
    expect(hook.statusCode).toBe(400);
    expect(hook.body).toContain("Webhooks need Pro.");

    // ntfy topics are on Free.
    const ntfy = await browser.submit("/settings", "/settings/ntfy", {
      name: "Phone",
      url: "https://ntfy.sh/freezer",
      token: "",
    });
    expect(ntfy.statusCode).toBe(303);
  });
});

describe("Pro Plan", () => {
  it("allows 30 s Intervals, Reminders and Webhooks until it ends", async () => {
    const ctx = await freeUser();
    await setPlan(ctx, new Date(ctx.clock.now().getTime() + 30 * DAY));
    const res = await createMonitor(ctx.browser, {
      interval: "30",
      reminderEvery: "3600",
    });
    expect(res.statusCode).toBe(303);
    expect((await addWebhook(ctx.browser)).statusCode).toBe(303);
    const body = (await ctx.browser.get("/settings")).body;
    expect(body).toMatch(/<strong>Pro<\/strong>\s*until 2026-01-31/);
    expect(body).toContain("1 of 100 Monitors");
  });

  it("keeps a Monitor's Pro settings editable after Pro ends, as long as they don't change", async () => {
    const ctx = await freeUser();
    await setPlan(ctx, new Date(ctx.clock.now().getTime() + DAY));
    const created = await createMonitor(ctx.browser, {
      interval: "30",
      reminderEvery: "3600",
    });
    const page = created.headers.location as string;
    ctx.clock.advance(2 * DAY);

    const rename = await ctx.browser.submit(
      `${page}/edit`,
      `${page}/edit`,
      monitorFields({
        name: "Chest freezer",
        interval: "30",
        reminderEvery: "3600",
      }),
    );
    expect(rename.statusCode).toBe(303);

    const faster = await ctx.browser.submit(
      `${page}/edit`,
      `${page}/edit`,
      monitorFields({ interval: "45", reminderEvery: "3600" }),
    );
    expect(faster.statusCode).toBe(400);
    expect(faster.body).toContain("Intervals shorter than 1 min need Pro.");
  });
});

describe("Plans launch", () => {
  it("gives every existing User 6 months of Pro, once; later Users start Free", async () => {
    const ctx = await buildTestApp();
    await createUser(ctx.db, { email: EMAIL, password: PASSWORD });

    ctx.config.plansEnabled = true;
    ctx.app = await restartApp(ctx);
    const user = await ctx.db.collection("users").findOne({ email: EMAIL });
    expect(user!.plan).toEqual({
      proUntil: new Date("2026-07-01T00:00:00Z"),
      source: "comp",
      proEndedAt: null,
    });

    await createUser(ctx.db, { email: "new@example.com", password: PASSWORD });
    ctx.clock.advance(DAY);
    ctx.app = await restartApp(ctx);
    const again = await ctx.db.collection("users").findOne({ email: EMAIL });
    expect(again!.plan.proUntil).toEqual(new Date("2026-07-01T00:00:00Z"));
    const later = await ctx.db
      .collection("users")
      .findOne({ email: "new@example.com" });
    expect(later!.plan).toBeUndefined();

    const browser = await login(ctx.app, "new@example.com", PASSWORD);
    expect((await browser.get("/settings")).body).toMatch(
      /<strong>Free<\/strong>/,
    );
  });
});
