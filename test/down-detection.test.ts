import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  restartApp,
  stateOf,
  type Browser,
} from "./helpers.js";

const SEC = 1000;

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

/** Creates a Monitor and returns its page path and Heartbeat path. */
async function createMonitor(
  browser: Browser,
  intervalSec: number,
  graceSec: number,
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Garden sensor",
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

describe("Down detection", () => {
  it("goes Down after Interval + Grace period and back Up on the next Heartbeat", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });

    clock.advance(91 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");

    clock.advance(30 * SEC);
    await app.inject({ method: "GET", url: m.hb });
    expect(await stateOf(browser, m.page)).toBe("Up");
    const body = (await browser.get(m.page)).body;
    expect(body).toContain("Incidents");
    expect(body).not.toContain("ongoing");
    expect(body).toMatch(/<td>\s*31 s\s*<\/td>/);
  });

  it("never leaves an Incident open when a Heartbeat races the Down checker", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });

    for (let i = 0; i < 10; i++) {
      clock.advance(91 * SEC);
      await Promise.all([app.tick(), app.inject({ method: "GET", url: m.hb })]);
      const body = (await browser.get(m.page)).body;
      expect(body).toContain('class="badge badge-up">Up</span>');
      expect(body).not.toContain("ongoing");
    }
  });

  it("stays Up until the deadline", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });

    clock.advance(89 * SEC);
    await app.tick();

    expect(await stateOf(browser, m.page)).toBe("Up");
  });

  it("never moves a New Monitor to Down", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);

    clock.advance(24 * 60 * 60 * SEC);
    await app.tick();

    expect(await stateOf(browser, m.page)).toBe("New");
  });

  it("gives every Monitor a full Interval + Grace period after nodbeat restarts", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser, 60, 30);
    await ctx.app.inject({ method: "GET", url: m.hb });

    // nodbeat is down for 10 min, long past the Monitor's deadline.
    ctx.clock.advance(10 * 60 * SEC);
    const app = await restartApp(ctx);
    const browser = await login(app, "me@example.com", "correct horse");

    ctx.clock.advance(89 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");

    ctx.clock.advance(2 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });
});

describe("Monitor page history", () => {
  it("lists Incidents with start, end and duration, newest first", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    // Clock starts at 2026-01-01 00:00:00 UTC; the User's time zone is Europe/Warsaw (UTC+1).
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick(); // Down since the deadline, 01:01:30
    clock.advance(30 * SEC);
    await app.inject({ method: "GET", url: m.hb }); // Up at 01:02:01
    clock.advance(100 * SEC);
    await app.tick(); // Down since 01:03:31, still open
    clock.advance(5 * 60 * SEC);

    const body = (await browser.get(m.page)).body;

    expect(body).toMatch(
      /Incidents[\s\S]*2026-01-01 01:03:31[\s\S]*ongoing[\s\S]*5 min 10 s[\s\S]*2026-01-01 01:01:30[\s\S]*2026-01-01 01:02:01[\s\S]*31 s/,
    );
  });

  it("says when there are no Incidents", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);

    expect((await browser.get(m.page)).body).toContain("No Incidents yet.");
  });

  it("lists the last 7 days of Heartbeats with their messages, newest first", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 7 * 24 * 60 * 60, 0);
    await app.inject({ method: "GET", url: `${m.hb}?msg=too%20old` });
    clock.advance(7 * 24 * 60 * 60 * SEC - 1);
    await app.inject({ method: "GET", url: `${m.hb}?msg=first` });
    clock.advance(10 * SEC);
    await app.inject({ method: "GET", url: `${m.hb}?msg=%3Cb%3Esecond` });
    clock.advance(10 * SEC);

    const body = (await browser.get(m.page)).body;

    expect(body).toMatch(
      /Heartbeats[\s\S]*2026-01-08 01:00:09[\s\S]*&lt;b&gt;second[\s\S]*2026-01-08 00:59:59[\s\S]*first/,
    );
    expect(body).not.toContain("too old");
  });
});
