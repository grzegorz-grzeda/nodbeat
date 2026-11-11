import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  stateOf,
  type Browser,
} from "./helpers.js";

const SEC = 1000;
const MIN = 60 * SEC;

interface DashboardMonitor {
  state: string;
  nextExpectedAt: string | null;
  nextExpectedText: string;
}

// The clock starts at 2026-01-01 00:00 UTC, i.e. 01:00 in Warsaw.
async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
    timeZone: "Europe/Warsaw",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

/** Creates a 1 h / 5 min Monitor and returns its page path and Heartbeat path. */
async function createMonitor(
  browser: Browser,
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Nightly backup",
    interval: "1",
    intervalUnit: "h",
    grace: "5",
    graceUnit: "m",
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

/** The "Next expected by" time on a Monitor page, or undefined if not shown. */
async function nextExpectedOnPage(
  browser: Browser,
  page: string,
): Promise<string | undefined> {
  const body = (await browser.get(page)).body;
  return /Next expected by:\s*([^<]+?)\s*</.exec(body)?.[1];
}

async function onlyDashboardMonitor(
  browser: Browser,
): Promise<DashboardMonitor> {
  const res = await browser.get("/dashboard.json");
  const { monitors } = res.json() as { monitors: DashboardMonitor[] };
  expect(monitors).toHaveLength(1);
  return monitors[0]!;
}

describe("Next expected Heartbeat", () => {
  it("shows when an Up Monitor is due, and it goes Down in that minute", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    clock.advance(10 * MIN);
    await app.inject({ method: "GET", url: m.hb });

    // 00:10 UTC + 1 h + 5 min = 01:15 UTC = 02:15 in Warsaw.
    expect(await nextExpectedOnPage(browser, m.page)).toBe("02:15");

    clock.advance(65 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("shows the same time on the Dashboard and in its live update", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    clock.advance(10 * MIN);
    await app.inject({ method: "GET", url: m.hb });

    const page = (await browser.get("/")).body;
    expect(page).toContain("<th>Next expected by</th>");
    expect(page).toMatch(/data-label="Next expected by">\s*02:15\s*</);
    const live = await onlyDashboardMonitor(browser);
    expect(live.nextExpectedText).toBe("02:15");
    expect(live.nextExpectedAt).toBe("2026-01-01T01:15:00.000Z");
  });

  it("shows a New Monitor as due Interval + Grace period after its creation", async () => {
    const { browser, clock } = await loggedIn();
    clock.advance(20 * MIN);
    const m = await createMonitor(browser);

    // 00:20 UTC + 1 h 5 min = 01:25 UTC = 02:25 in Warsaw.
    expect(await stateOf(browser, m.page)).toBe("New");
    expect(await nextExpectedOnPage(browser, m.page)).toBe("02:25");
    expect((await onlyDashboardMonitor(browser)).nextExpectedText).toBe(
      "02:25",
    );
  });

  it("shows nothing for a Down Monitor", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(65 * MIN);
    await app.tick();

    expect(await stateOf(browser, m.page)).toBe("Down");
    expect(await nextExpectedOnPage(browser, m.page)).toBeUndefined();
    const live = await onlyDashboardMonitor(browser);
    expect(live.nextExpectedAt).toBeNull();
    expect(live.nextExpectedText).toBe("");
  });

  it("shows nothing while Paused, and counts from the unpause after", async () => {
    const { browser, clock } = await loggedIn();
    const m = await createMonitor(browser);
    await browser.submit(m.page, `${m.page}/pause`);

    expect(await stateOf(browser, m.page)).toBe("Paused");
    expect(await nextExpectedOnPage(browser, m.page)).toBeUndefined();
    expect((await onlyDashboardMonitor(browser)).nextExpectedAt).toBeNull();

    clock.advance(30 * MIN);
    await browser.submit(m.page, `${m.page}/unpause`);
    // 00:30 UTC + 1 h 5 min = 01:35 UTC = 02:35 in Warsaw.
    expect(await nextExpectedOnPage(browser, m.page)).toBe("02:35");
  });

  it("adds the date when the Monitor is due on another day", async () => {
    const { browser } = await loggedIn();
    const res = await browser.submit("/monitors/new", "/monitors", {
      name: "Weekly report",
      interval: "2",
      intervalUnit: "d",
      grace: "1",
      graceUnit: "h",
    });
    const page = res.headers.location as string;

    // 2026-01-01 00:00 UTC + 2 d 1 h = 2026-01-03 01:00 UTC = 02:00 in Warsaw.
    expect(await nextExpectedOnPage(browser, page)).toBe("2026-01-03 02:00");
  });
});
