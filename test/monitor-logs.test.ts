import { describe, expect, it } from "vitest";
import {
  Browser,
  buildTestApp,
  createUser,
  login,
  type TestContext,
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

async function createMonitor(
  browser: Browser,
  intervalSec = 60,
  graceSec = 30,
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

/** Sends `count` Heartbeats with messages `hb-1` … `hb-<count>`, 2 s apart (the limit is 1/s). */
async function sendHeartbeats(
  ctx: TestContext,
  hb: string,
  count: number,
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await ctx.app.inject({ method: "GET", url: `${hb}?msg=hb-${i}` });
    ctx.clock.advance(2 * SEC);
  }
}

/** Heartbeat messages shown on a page, in page order. */
const messages = (body: string) =>
  [...body.matchAll(/<td>(hb-\d+)<\/td>/g)].map((m) => m[1]);

/** Rows of the Incidents table on a page (header row left out). */
const incidentRows = (body: string) =>
  (body.split("<h2>Heartbeats")[0]!.match(/<tr>/g)?.length ?? 1) - 1;

describe("Monitor logs", () => {
  it("shows the 20 newest Heartbeats on the Monitor page and links the full log", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await sendHeartbeats(ctx, m.hb, 105);

    const body = (await ctx.browser.get(m.page)).body;

    expect(messages(body)).toHaveLength(20);
    expect(messages(body)[0]).toBe("hb-105");
    expect(messages(body)[19]).toBe("hb-86");
    expect(body).toContain(`href="${m.page}/heartbeats"`);
  });

  it("pages through every kept Heartbeat, 100 a page, newest first", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await sendHeartbeats(ctx, m.hb, 105);

    const first = (await ctx.browser.get(`${m.page}/heartbeats`)).body;
    const second = (await ctx.browser.get(`${m.page}/heartbeats?page=2`)).body;

    expect(messages(first)).toHaveLength(100);
    expect(messages(first)[0]).toBe("hb-105");
    expect(first).toContain("Page 1 of 2");
    expect(first).toContain(`href="${m.page}/heartbeats?page=2"`);
    expect(messages(second)).toEqual(["hb-5", "hb-4", "hb-3", "hb-2", "hb-1"]);
    expect(second).toContain(`href="${m.page}/heartbeats?page=1"`);
    expect(second).toContain(`href="${m.page}"`);
    expect(
      (await ctx.browser.get(`${m.page}/heartbeats?page=3`)).statusCode,
    ).toBe(404);
  });

  it("doesn't link the full log while everything fits on the Monitor page", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await sendHeartbeats(ctx, m.hb, 20);

    const body = (await ctx.browser.get(m.page)).body;

    expect(messages(body)).toHaveLength(20);
    expect(body).not.toContain(`${m.page}/heartbeats`);
    expect(body).not.toContain(`${m.page}/incidents`);
  });

  it("shows the 20 newest Incidents on the Monitor page and all of them on the Incidents page", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser, 30, 0);
    for (let i = 0; i < 21; i++) {
      await ctx.app.inject({ method: "GET", url: m.hb });
      ctx.clock.advance(31 * SEC);
      await ctx.app.tick();
    }

    const page = (await ctx.browser.get(m.page)).body;
    const all = (await ctx.browser.get(`${m.page}/incidents`)).body;

    expect(incidentRows(page)).toBe(20);
    expect(page).toContain(`href="${m.page}/incidents"`);
    expect(incidentRows(all)).toBe(21);
    expect(all).not.toContain("Page 1 of");
  });

  it("keeps the log pages to the Monitor's owner", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser);
    await createUser(ctx.db, {
      email: "bob@example.com",
      password: "correct horse",
    });
    const bob = await login(ctx.app, "bob@example.com", "correct horse");
    const anonymous = new Browser(ctx.app);

    for (const log of ["incidents", "heartbeats"]) {
      expect((await bob.get(`${m.page}/${log}`)).statusCode).toBe(404);
      const res = await anonymous.get(`${m.page}/${log}`);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe("/login");
    }
  });
});
