import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { listHeartbeatsSince } from "../src/heartbeats.js";
import { listIncidents } from "../src/incidents.js";
import { listPeriodsSince } from "../src/state-periods.js";
import { buildTestApp, createUser, login, type Browser } from "./helpers.js";

const SEC = 1000;

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

/** Creates a Monitor and returns its page path and Heartbeat path. */
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
  return { page, hb: heartbeatPath((await browser.get(page)).body) };
}

const heartbeatPath = (body: string) =>
  /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;

const stateOf = async (browser: Browser, page: string) =>
  /State: <strong>(\w+)<\/strong>/.exec((await browser.get(page)).body)?.[1];

describe("editing a Monitor", () => {
  it("shows the current settings and saves new ones", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser, 120, 30);

    const form = await browser.get(`${m.page}/edit`);
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('value="Garden sensor"');
    expect(form.body).toMatch(/name="interval"\s+value="2"/);

    const res = await browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "Shed sensor",
      interval: "10",
      intervalUnit: "m",
      grace: "1",
      graceUnit: "m",
      notes: "Moved to the shed",
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(m.page);

    const body = (await browser.get(m.page)).body;
    expect(body).toContain("Shed sensor");
    expect(body).toContain("Moved to the shed");
    expect(body).toContain("Interval: 10 min");
    expect(body).toContain("Grace period: 1 min");
  });

  it("rejects settings outside the limits", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser);

    const res = await browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "x",
      interval: "10",
      intervalUnit: "s",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Interval must be between 30 s and 7 d");
    expect((await browser.get(m.page)).body).toContain("Interval: 1 min");
  });

  it("recalculates the deadline with the new Interval and Grace period", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });

    await browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "Garden sensor",
      interval: "300",
      intervalUnit: "s",
      grace: "0",
      graceUnit: "s",
    });
    clock.advance(299 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");

    clock.advance(1 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("counts a shorter Interval from the edit, never backdating an Incident", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(80 * SEC);

    await browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "Garden sensor",
      interval: "30",
      intervalUnit: "s",
      grace: "0",
      graceUnit: "s",
    });
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");

    clock.advance(30 * SEC);
    await app.tick();
    // Edited at 01:01:20 (Europe/Warsaw); Down 30 s later.
    expect((await browser.get(m.page)).body).toMatch(
      /State: <strong>Down<\/strong>[\s\S]*2026-01-01 01:01:50[\s\S]*ongoing/,
    );
  });

  it("links to the edit form from the Monitor page", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser);

    expect((await browser.get(m.page)).body).toContain(`href="${m.page}/edit"`);
  });

  it("doesn't let a User change another User's Monitor", async () => {
    const { app, db, browser } = await loggedIn();
    const m = await createMonitor(browser);
    await createUser(db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(app, "other@example.com", "correct horse");

    expect((await other.get(`${m.page}/edit`)).statusCode).toBe(404);
    for (const action of [
      "edit",
      "pause",
      "unpause",
      "regenerate-url",
      "alerts",
      "delete",
    ]) {
      const res = await other.submit("/", `${m.page}/${action}`, {
        name: "Hijacked",
        interval: "60",
        intervalUnit: "s",
        alertsEnabled: "false",
      });
      expect(res.statusCode).toBe(404);
    }
    const body = (await browser.get(m.page)).body;
    expect(body).toContain("Garden sensor");
    expect(body).toContain("State: <strong>New</strong>");
  });
});

describe("regenerating the Heartbeat URL", () => {
  it("gives the Monitor a new URL and makes the old one return 404", async () => {
    const { app, browser } = await loggedIn();
    const m = await createMonitor(browser);

    const res = await browser.submit(m.page, `${m.page}/regenerate-url`);
    expect(res.statusCode).toBe(303);

    const newHb = heartbeatPath((await browser.get(m.page)).body);
    expect(newHb).not.toBe(m.hb);
    expect((await app.inject({ method: "GET", url: m.hb })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: "GET", url: newHb })).statusCode).toBe(
      200,
    );
  });
});

describe("pausing a Monitor", () => {
  it("never goes Down while Paused, and still accepts and records Heartbeats", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });

    const res = await browser.submit(m.page, `${m.page}/pause`);
    expect(res.statusCode).toBe(303);
    expect(await stateOf(browser, m.page)).toBe("Paused");

    clock.advance(24 * 60 * 60 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Paused");

    const hb = await app.inject({
      method: "GET",
      url: `${m.hb}?msg=still%20here`,
    });
    expect(hb.statusCode).toBe(200);
    clock.advance(24 * 60 * 60 * SEC);
    await app.tick();
    const body = (await browser.get(m.page)).body;
    expect(body).toContain("State: <strong>Paused</strong>");
    expect(body).toContain("still here");
  });

  it("closes the open Incident when a Down Monitor is paused", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick();
    expect((await browser.get(m.page)).body).toContain("ongoing");

    clock.advance(9 * SEC);
    await browser.submit(m.page, `${m.page}/pause`);

    const body = (await browser.get(m.page)).body;
    expect(body).not.toContain("ongoing");
    expect(body).toMatch(/2026-01-01 01:01:40\s*\(paused\)/);
    expect(body).toMatch(/<td>\s*10 s\s*<\/td>/);
  });
});

describe("unpausing a Monitor", () => {
  it("resumes as Up with a fresh Interval + Grace period if a Heartbeat arrived during the pause", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await browser.submit(m.page, `${m.page}/pause`);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(10 * 60 * SEC);

    await browser.submit(m.page, `${m.page}/unpause`);
    expect(await stateOf(browser, m.page)).toBe("Up");

    clock.advance(89 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(1 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("resumes as New if no Heartbeat arrived during the pause", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(10 * SEC);
    await browser.submit(m.page, `${m.page}/pause`);
    clock.advance(10 * 60 * SEC);

    await browser.submit(m.page, `${m.page}/unpause`);
    clock.advance(24 * 60 * 60 * SEC);
    await app.tick();

    expect(await stateOf(browser, m.page)).toBe("New");
  });

  it("shows Pause or Unpause on the Monitor page depending on the state", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser);

    expect((await browser.get(m.page)).body).toContain(
      `action="${m.page}/pause"`,
    );
    await browser.submit(m.page, `${m.page}/pause`);
    const body = (await browser.get(m.page)).body;
    expect(body).toContain(`action="${m.page}/unpause"`);
    expect(body).not.toContain(`action="${m.page}/pause"`);
  });
});

describe("the Alerts switch", () => {
  it("is on for a new Monitor and can be turned off and on again", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser);
    expect((await browser.get(m.page)).body).toMatch(
      /Alerts:\s*<strong>on<\/strong>/,
    );

    const res = await browser.submit(m.page, `${m.page}/alerts`, {
      alertsEnabled: "false",
    });
    expect(res.statusCode).toBe(303);
    expect((await browser.get(m.page)).body).toMatch(
      /Alerts:\s*<strong>off<\/strong>/,
    );

    await browser.submit(m.page, `${m.page}/alerts`, { alertsEnabled: "true" });
    expect((await browser.get(m.page)).body).toMatch(
      /Alerts:\s*<strong>on<\/strong>/,
    );
  });

  it("rejects anything but true or false", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser);

    const res = await browser.submit(m.page, `${m.page}/alerts`, {
      alertsEnabled: "maybe",
    });

    expect(res.statusCode).toBe(400);
    expect((await browser.get(m.page)).body).toMatch(
      /Alerts:\s*<strong>on<\/strong>/,
    );
  });
});

describe("deleting a Monitor", () => {
  it("asks for confirmation first", async () => {
    const { browser } = await loggedIn();
    const m = await createMonitor(browser);
    expect((await browser.get(m.page)).body).toContain(
      `href="${m.page}/delete"`,
    );

    const confirm = await browser.get(`${m.page}/delete`);

    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toContain("Delete Garden sensor?");
    expect(confirm.body).toContain(`action="${m.page}/delete"`);
    expect(await stateOf(browser, m.page)).toBe("New");
  });

  it("removes the Monitor with its Heartbeats, Incidents and pause periods", async () => {
    const { app, browser, clock, db } = await loggedIn();
    const m = await createMonitor(browser, 60, 30);
    const id = new ObjectId(m.page.split("/").pop());
    await app.inject({ method: "GET", url: m.hb });
    clock.advance(91 * SEC);
    await app.tick();
    await browser.submit(m.page, `${m.page}/pause`);

    const res = await browser.submit(`${m.page}/delete`, `${m.page}/delete`);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/");
    expect((await browser.get(m.page)).statusCode).toBe(404);
    expect((await browser.get("/")).body).not.toContain("Garden sensor");
    expect((await app.inject({ method: "GET", url: m.hb })).statusCode).toBe(
      404,
    );
    expect(await listIncidents(db, id, 10)).toEqual([]);
    expect(await listHeartbeatsSince(db, id, new Date(0), 10)).toEqual([]);
    for (const state of ["new", "paused"] as const) {
      expect(await listPeriodsSince(db, state, id, new Date(0))).toEqual([]);
    }
  });
});
