import { describe, expect, it } from "vitest";
import {
  Browser,
  buildTestApp,
  createUser,
  login,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;

interface DashboardMonitor {
  id: string;
  name: string;
  state: string;
  lastHeartbeatAt: string | null;
  lastMessage: string | null;
  uptime7d: number | null;
  uptime7dText: string;
}

async function loggedIn(ctx?: TestContext, email = "me@example.com") {
  ctx ??= await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

/** Creates a Monitor (60 s / 30 s) and returns its page path and Heartbeat path. */
async function createMonitor(
  browser: Browser,
  name = "Garden sensor",
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name,
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

async function dashboard(browser: Browser): Promise<DashboardMonitor[]> {
  const res = await browser.get("/dashboard.json");
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("application/json");
  return (res.json() as { monitors: DashboardMonitor[] }).monitors;
}

async function onlyMonitor(browser: Browser): Promise<DashboardMonitor> {
  const list = await dashboard(browser);
  expect(list).toHaveLength(1);
  return list[0]!;
}

describe("Dashboard JSON", () => {
  it("lists the User's Monitors with state, last Heartbeat and last message", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: `${m.hb}?msg=hello` });
    clock.advance(5 * SEC);

    expect(await onlyMonitor(browser)).toMatchObject({
      id: m.page.split("/").pop(),
      name: "Garden sensor",
      state: "up",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      lastMessage: "hello",
    });
  });

  it("shows only the logged-in User's Monitors", async () => {
    const ctx = await buildTestApp();
    const alice = (await loggedIn(ctx, "alice@example.com")).browser;
    const bob = (await loggedIn(ctx, "bob@example.com")).browser;
    await createMonitor(alice, "Alice's Pi");
    await createMonitor(bob, "Bob's cron");

    expect((await dashboard(alice)).map((m) => m.name)).toEqual(["Alice's Pi"]);
    expect((await dashboard(bob)).map((m) => m.name)).toEqual(["Bob's cron"]);
  });

  it("is refused without a login", async () => {
    const { app } = await buildTestApp();
    const res = await new Browser(app).get("/dashboard.json");
    expect(res.statusCode).toBe(401);
  });
});

describe("7-day Uptime", () => {
  it('is "—" for a Monitor that has never sent a Heartbeat', async () => {
    const { browser, clock } = await loggedIn();
    await createMonitor(browser);
    clock.advance(DAY);

    expect(await onlyMonitor(browser)).toMatchObject({
      uptime7d: null,
      uptime7dText: "—",
    });
  });

  it("is time Up over time Up or Down", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick(); // Down since 00:01:30
    clock.advance(30 * SEC);
    await app.inject({ method: "GET", url: m.hb }); // Up at 00:02:01
    clock.advance(79 * SEC);

    // Up 90 s + 79 s, Down 31 s.
    expect(await onlyMonitor(browser)).toMatchObject({
      uptime7d: 169 / 200,
      uptime7dText: "84.50%",
    });
  });

  it("leaves out New time, also before the first Heartbeat", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    clock.advance(1000 * SEC); // New
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick(); // Down since 90 s after the Heartbeat
    clock.advance(9 * SEC);

    expect(await onlyMonitor(browser)).toMatchObject({
      uptime7d: 0.9,
      uptime7dText: "90.00%",
    });
  });

  it("leaves out Paused time and the New time after unpausing", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick(); // Down since 00:01:30
    await browser.submit(m.page, `${m.page}/pause`); // Down 1 s
    clock.advance(1000 * SEC);
    await browser.submit(m.page, `${m.page}/unpause`); // New
    clock.advance(100 * SEC);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(9 * SEC);

    // Up 90 s + 9 s, Down 1 s.
    expect(await onlyMonitor(browser)).toMatchObject({
      uptime7d: 0.99,
      uptime7dText: "99.00%",
    });
  });

  it('is "—" when the Monitor was Paused for the whole window', async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(60 * SEC);
    await browser.submit(m.page, `${m.page}/pause`);
    clock.advance(8 * DAY);

    expect(await onlyMonitor(browser)).toMatchObject({
      state: "paused",
      uptime7d: null,
      uptime7dText: "—",
    });
  });

  it("only counts the last 7 days", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick(); // Down for 31 s, more than 7 days ago by the end
    clock.advance(30 * SEC);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(8 * DAY);

    expect(await onlyMonitor(browser)).toMatchObject({
      uptime7d: 1,
      uptime7dText: "100.00%",
    });
  });

  it("rounds down, so any Down time keeps it below 100%", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick(); // Down since 00:01:30
    clock.advance(SEC);
    await app.inject({ method: "GET", url: m.hb }); // Down 2 s
    clock.advance(6 * DAY);

    expect((await onlyMonitor(browser)).uptime7dText).toBe("99.99%");
  });
});

describe("Dashboard page", () => {
  it("shows the 7-day Uptime and polls the JSON endpoint", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(60 * SEC);

    const body = (await browser.get("/")).body;
    expect(body).toContain("7-day Uptime");
    expect(body).toContain("100.00%");
    expect(body).toContain("/assets/dashboard.js");
  });
});

describe("time zone setting", () => {
  it("defaults to Europe/Warsaw and can be changed", async () => {
    const { browser } = await loggedIn();
    expect((await browser.get("/settings")).body).toMatch(
      /<option\s+value="Europe\/Warsaw"\s+selected\s*>/,
    );

    const res = await browser.submit("/settings", "/settings/time-zone", {
      timeZone: "America/New_York",
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/settings");
    expect((await browser.get("/settings")).body).toMatch(
      /<option\s+value="America\/New_York"\s+selected\s*>/,
    );
  });

  it("rejects an unknown time zone", async () => {
    const { browser } = await loggedIn();
    const res = await browser.submit("/settings", "/settings/time-zone", {
      timeZone: "Mars/Olympus_Mons",
    });
    expect(res.statusCode).toBe(400);
    expect((await browser.get("/settings")).body).toMatch(
      /<option\s+value="Europe\/Warsaw"\s+selected\s*>/,
    );
  });

  it("is used for times shown on the Monitor page", async () => {
    const { app, browser } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    expect((await browser.get(m.page)).body).toContain("2026-01-01 01:00:00");

    await browser.submit("/settings", "/settings/time-zone", {
      timeZone: "America/New_York",
    });
    expect((await browser.get(m.page)).body).toContain("2025-12-31 19:00:00");
  });
});
