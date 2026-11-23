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
    expect(body).toMatch(/Depends on: needs Pro/);
    expect(body).toMatch(/50 Heartbeats \(up to\s+7 d\),\s+50 Incidents/);
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

describe("Admin gives and ends Pro", () => {
  async function withAdmin(plansEnabled = true) {
    const ctx = await buildTestApp({ plansEnabled });
    await createUser(ctx.db, {
      email: "admin@example.com",
      password: PASSWORD,
      admin: true,
    });
    await createUser(ctx.db, {
      email: EMAIL,
      password: PASSWORD,
      timeZone: "UTC",
    });
    const admin = await login(ctx.app, "admin@example.com", PASSWORD);
    const browser = await login(ctx.app, EMAIL, PASSWORD);
    const user = await ctx.db.collection("users").findOne({ email: EMAIL });
    return { ...ctx, admin, browser, userId: String(user!._id) };
  }

  it("counts Users per Plan and gives Pro until a date, then ends it", async () => {
    const ctx = await withAdmin();
    const page = (await ctx.admin.get("/admin")).body;
    expect(page).toContain("Users by Plan");
    expect(page).toMatch(/<th scope="col">Plan<\/th>/);
    expect(page).toContain(`href="/admin/users/${ctx.userId}/pro"`);
    expect((await addWebhook(ctx.browser)).statusCode).toBe(400);

    const give = `/admin/users/${ctx.userId}/pro`;
    const form = await ctx.admin.get(give);
    expect(form.body).toContain(`Give ${EMAIL} Pro`);
    const past = await ctx.admin.submit(give, give, { until: "2025-12-31" });
    expect(past.statusCode).toBe(400);
    expect(past.body).toContain("Choose a date after today.");
    const res = await ctx.admin.submit(give, give, { until: "2026-03-01" });
    expect(res.statusCode).toBe(303);
    const user = await ctx.db.collection("users").findOne({ email: EMAIL });
    expect(user!.plan).toEqual({
      proUntil: new Date("2026-03-01T00:00:00Z"),
      source: "comp",
      proEndedAt: null,
    });
    expect((await addWebhook(ctx.browser)).statusCode).toBe(303);
    expect((await ctx.browser.get("/settings")).body).toMatch(
      /<strong>Pro<\/strong>\s*until 2026-03-01/,
    );
    expect((await ctx.admin.get("/admin")).body).toContain(
      `href="/admin/users/${ctx.userId}/end-pro"`,
    );

    const end = `/admin/users/${ctx.userId}/end-pro`;
    expect((await ctx.admin.get(end)).body).toContain(`End Pro for ${EMAIL}?`);
    expect((await ctx.admin.submit(end, end)).statusCode).toBe(303);
    expect((await ctx.browser.get("/settings")).body).toMatch(
      /<strong>Free<\/strong>/,
    );
    const hook = await ctx.browser.submit("/settings", "/settings/webhooks", {
      name: "Second",
      url: "https://hooks.example.com/second",
      secret: "",
    });
    expect(hook.statusCode).toBe(400);
  });

  it("reads the date in the User's time zone", async () => {
    const ctx = await withAdmin();
    await ctx.db
      .collection("users")
      .updateOne({ email: EMAIL }, { $set: { timeZone: "Europe/Warsaw" } });
    const give = `/admin/users/${ctx.userId}/pro`;
    await ctx.admin.submit(give, give, { until: "2026-07-01" });
    const user = await ctx.db.collection("users").findOne({ email: EMAIL });
    expect(user!.plan.proUntil).toEqual(new Date("2026-06-30T22:00:00Z"));
  });

  it("is only for the Admin", async () => {
    const ctx = await withAdmin();
    const res = await ctx.browser.get(`/admin/users/${ctx.userId}/pro`);
    expect(res.statusCode).not.toBe(200);
  });

  it("is hidden with Plans off", async () => {
    const ctx = await withAdmin(false);
    const page = (await ctx.admin.get("/admin")).body;
    expect(page).not.toContain("Users by Plan");
    expect(page).not.toMatch(/<th scope="col">Plan<\/th>/);
    expect(
      (await ctx.admin.get(`/admin/users/${ctx.userId}/pro`)).statusCode,
    ).toBe(404);
  });
});

describe("Logs by Plan", () => {
  const sendHeartbeats = async (ctx: TestContext, hb: string, n: number) => {
    for (let i = 1; i <= n; i++) {
      await ctx.app.inject({ method: "GET", url: `${hb}?msg=hb-${i}` });
      ctx.clock.advance(2000);
    }
  };
  const heartbeatUrl = async (browser: Browser, page: string) =>
    /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(
      (await browser.get(page)).body,
    )![1]!;
  const kept = (ctx: TestContext) =>
    ctx.db.collection("heartbeats").countDocuments();

  it("trims a Free Monitor to 50 Heartbeats kept 7 days", async () => {
    const ctx = await freeUser();
    const page = (await createMonitor(ctx.browser)).headers.location as string;
    const hb = await heartbeatUrl(ctx.browser, page);
    await sendHeartbeats(ctx, hb, 60);
    await ctx.app.tick();
    expect(await kept(ctx)).toBe(50);
    const log = (await ctx.browser.get(`${page}/heartbeats`)).body;
    expect(log).toContain("Heartbeats (newest 50, last 7 d)");
    const one = await ctx.db.collection("heartbeats").findOne({});
    expect(one!.expiresAt.getTime() - one!.receivedAt.getTime()).toBe(7 * DAY);
  });

  it("keeps more on Pro: 1000 Heartbeats for 90 days", async () => {
    const ctx = await freeUser();
    await setPlan(ctx, new Date(ctx.clock.now().getTime() + 365 * DAY));
    const page = (await createMonitor(ctx.browser)).headers.location as string;
    const hb = await heartbeatUrl(ctx.browser, page);
    await sendHeartbeats(ctx, hb, 120);
    await ctx.app.tick();
    expect(await kept(ctx)).toBe(120);
    const one = await ctx.db.collection("heartbeats").findOne({});
    expect(one!.expiresAt.getTime() - one!.receivedAt.getTime()).toBe(90 * DAY);
    const log = (await ctx.browser.get(`${page}/heartbeats`)).body;
    expect(log).toContain("Heartbeats (newest 1000, last 90 d)");
  });

  it("keeps Free Incidents past 50 while 7-day Uptime needs them", async () => {
    const ctx = await freeUser();
    const page = (await createMonitor(ctx.browser)).headers.location as string;
    const hb = await heartbeatUrl(ctx.browser, page);
    for (let i = 0; i < 55; i++) {
      await ctx.app.inject({ method: "GET", url: hb });
      ctx.clock.advance(91 * 1000);
      await ctx.app.tick();
    }
    await ctx.app.inject({ method: "GET", url: hb });
    await ctx.app.tick();
    const incidents = ctx.db.collection("incidents");
    expect(await incidents.countDocuments()).toBe(55);
    ctx.clock.advance(8 * DAY);
    await ctx.app.inject({ method: "GET", url: hb });
    await ctx.app.tick();
    expect(await incidents.countDocuments()).toBe(50);
  });
});
