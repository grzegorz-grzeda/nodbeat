import { describe, expect, it } from "vitest";
import type { DashboardMonitor } from "../src/dashboard.js";
import {
  buildTestApp,
  createUser,
  login,
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

/** The Heartbeats log's cells, newest row first, without the Received column. */
async function logRows(browser: Browser, page: string): Promise<string[][]> {
  const log = (await browser.get(`${page}/heartbeats`)).body;
  return [...log.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .slice(1)
    .map((r) =>
      [...r[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)]
        .map((c) => c[1]!.trim())
        .slice(1),
    );
}

async function onlyMonitor(browser: Browser): Promise<DashboardMonitor> {
  const res = await browser.get("/dashboard.json");
  const list = (res.json() as { monitors: DashboardMonitor[] }).monitors;
  expect(list).toHaveLength(1);
  return list[0]!;
}

describe("Start signal", () => {
  it("times a Run: Start, 42 s, success shows 42 s in the log, on the Monitor page and the Dashboard", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);

    const start = await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });
    expect(start.statusCode).toBe(200);
    expect(start.headers["content-type"]).toMatch(/^text\/plain/);
    expect(start.body).toBe("OK");
    ctx.clock.advance(42 * SEC);
    await ctx.app.inject({ method: "GET", url: `${m.hb}?msg=done` });

    const log = (await ctx.browser.get(`${m.page}/heartbeats`)).body;
    expect(log).toContain("<th>Run duration</th>");
    expect(await logRows(ctx.browser, m.page)).toEqual([
      ["✓", "42 s", "done"],
      ["Start", "", ""],
    ]);
    expect((await ctx.browser.get(m.page)).body).toContain(
      "Last Run duration: 42 s",
    );
    const dash = await onlyMonitor(ctx.browser);
    expect(dash.lastRunDurationSec).toBe(42);
    expect(dash.lastRunDurationText).toBe("42 s");
    expect((await ctx.browser.get("/")).body).toContain("42 s");
  });

  it("shows no Run duration before any Run has ended", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: m.hb });

    expect((await ctx.browser.get(m.page)).body).not.toContain(
      "Last Run duration",
    );
    const dash = await onlyMonitor(ctx.browser);
    expect(dash.lastRunDurationSec).toBeNull();
    expect(dash.lastRunDurationText).toBe("");
  });

  it("ends a Run with a Fail signal: duration recorded and the Monitor Down", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "POST", url: `${m.hb}/start` });
    ctx.clock.advance(7 * SEC);
    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail?msg=oops` });

    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
    expect((await logRows(ctx.browser, m.page))[0]).toEqual([
      "Fail",
      "7 s",
      "oops",
    ]);
    expect((await onlyMonitor(ctx.browser)).lastRunDurationSec).toBe(7);
  });

  it("leaves a New Monitor New", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);

    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });
    ctx.clock.advance(600 * SEC);
    await ctx.app.tick();

    expect(await stateOf(ctx.browser, m.page)).toBe("New");
    expect((await onlyMonitor(ctx.browser)).lastHeartbeatAt).toBeNull();
  });

  it("is not a Heartbeat: an Up Monitor that only starts goes Down at the usual deadline", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: m.hb });
    ctx.clock.advance(60 * SEC);
    await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });

    ctx.clock.advance(29 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Up");
    ctx.clock.advance(1 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, m.page)).toBe("Down");
  });

  it("only records a Start signal to a Paused Monitor", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.browser.submit(m.page, `${m.page}/pause`);

    const res = await ctx.app.inject({ method: "GET", url: `${m.hb}/start` });
    expect(res.statusCode).toBe(200);
    expect(await stateOf(ctx.browser, m.page)).toBe("Paused");
    expect((await logRows(ctx.browser, m.page))[0]![0]).toBe("Start");
  });

  it("lets a Start and a success through in the same second; two Starts in a second get 429", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    const hit = (url: string) => ctx.app.inject({ method: "GET", url });

    expect((await hit(`${m.hb}/start`)).statusCode).toBe(200);
    expect((await hit(m.hb)).statusCode).toBe(200);
    ctx.clock.advance(500);
    expect((await hit(`${m.hb}/start`)).statusCode).toBe(429);
  });

  it("answers 404 to HEAD and to an unknown token", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);

    const head = await ctx.app.inject({ method: "HEAD", url: `${m.hb}/start` });
    expect(head.statusCode).toBe(404);
    const unknown = await ctx.app.inject({
      method: "GET",
      url: "/hb/nope/start",
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("shows a cron example using Start, success and Fail on the Monitor page", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    const url = `https://nodbeat.test${m.hb}`;

    expect((await ctx.browser.get(m.page)).body).toContain(
      `curl -fsS -m 10 ${url}/start; /path/to/job.sh &amp;&amp; curl -fsS -m 10 ${url} || curl -fsS -m 10 ${url}/fail`,
    );
  });
});
