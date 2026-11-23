import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const MIN = 60 * SEC;
const PASSWORD = "correct horse";

async function setup() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email: "me@example.com", password: PASSWORD });
  const browser = await login(ctx.app, "me@example.com", PASSWORD);
  return { ...ctx, browser };
}

async function createMonitor(browser: Browser, name: string) {
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

const exportData = (browser: Browser) =>
  browser.submit("/settings", "/settings/export");

interface Export {
  version: number;
  exportedAt: string;
  user: Record<string, unknown>;
  monitors: Array<
    Record<string, unknown> & {
      incidents: Array<Record<string, unknown>>;
      heartbeats: Array<Record<string, unknown>>;
    }
  >;
  alertChannels: Array<Record<string, unknown>>;
}

async function populated(ctx: TestContext & { browser: Browser }) {
  const garden = await createMonitor(ctx.browser, "Garden sensor");
  await ctx.app.inject({ method: "GET", url: `${garden.hb}?msg=hello` });
  ctx.clock.advance(91 * SEC);
  await ctx.app.tick();
  await ctx.app.inject({ method: "GET", url: `${garden.hb}?msg=back` });
  await createMonitor(ctx.browser, "Backup job");
  await ctx.browser.submit("/settings", "/settings/webhooks", {
    name: "Hook",
    url: "https://hooks.example.com/nodbeat",
    secret: "webhook-secret-value",
  });
  await ctx.browser.submit("/settings", "/settings/ntfy", {
    name: "Topic",
    url: "https://ntfy.sh/my-alerts",
    token: "tk_ntfysecretvalue",
  });
  return garden;
}

describe("Download my data", () => {
  it("is offered in Settings", async () => {
    const ctx = await setup();
    const body = (await ctx.browser.get("/settings")).body;
    expect(body).toContain('action="/settings/export"');
    expect(body).toContain("Download my data");
  });

  it("gives one JSON file with the User, Monitors, Incidents, Heartbeats and Alert channels", async () => {
    const ctx = await setup();
    const garden = await populated(ctx);

    const res = await exportData(ctx.browser);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="nodbeat-export-${ctx.clock.now().toISOString().slice(0, 10)}.json"`,
    );
    const data = JSON.parse(res.body) as Export;
    expect(data.version).toBe(1);
    expect(data.exportedAt).toBe(ctx.clock.now().toISOString());
    expect(data.user).toMatchObject({
      email: "me@example.com",
      timeZone: "Europe/Warsaw",
    });
    expect(data.monitors.map((m) => m.name)).toEqual([
      "Garden sensor",
      "Backup job",
    ]);
    const [first, second] = data.monitors;
    expect(first!.heartbeatUrl).toBe(`https://nodbeat.test${garden.hb}`);
    expect(first!.state).toBe("up");
    expect(first!.heartbeats.map((h) => h.message)).toEqual(["back", "hello"]);
    expect(first!.incidents).toHaveLength(1);
    expect(first!.incidents[0]).toMatchObject({ endReason: "heartbeat" });
    expect(typeof first!.incidents[0]!.startedAt).toBe("string");
    expect(second!.heartbeats).toEqual([]);
    expect(second!.incidents).toEqual([]);
    expect(
      data.alertChannels.map((c) => [c.kind, c.name, c.secretSet]),
    ).toEqual([
      ["webhook", "Hook", true],
      ["ntfy", "Topic", true],
    ]);
  });

  it("leaves out password hash, sessions, Heartbeat tokens and channel secrets", async () => {
    const ctx = await setup();
    const garden = await populated(ctx);
    const res = await exportData(ctx.browser);
    const user = await ctx.db
      .collection("users")
      .findOne({ email: "me@example.com" });
    const sessions = await ctx.db.collection("sessions").find().toArray();
    for (const secret of [
      user!.passwordHash as string,
      "webhook-secret-value",
      "tk_ntfysecretvalue",
      ...sessions.map((s) => String(s._id)),
      ...[...ctx.browser.cookies.values()],
    ]) {
      expect(res.body).not.toContain(secret);
    }
    expect(res.body).not.toContain("passwordHash");
    expect(res.body).not.toContain('"token"');
    expect(res.body).not.toContain('"secret"');
    expect(res.body).not.toContain("lastExportAt");
    // The token only appears inside the Heartbeat URL.
    expect(res.body.split(garden.hb.slice(4)).length).toBe(2);
  });

  it("allows one export per hour", async () => {
    const ctx = await setup();
    expect((await exportData(ctx.browser)).statusCode).toBe(200);

    ctx.clock.advance(59 * MIN);
    const again = await exportData(ctx.browser);
    expect(again.statusCode).toBe(429);
    expect(again.body).toContain(
      "You can download your data again at 2026-01-01 02:00",
    );

    ctx.clock.advance(MIN);
    expect((await exportData(ctx.browser)).statusCode).toBe(200);
  });

  it("never holds another User's data", async () => {
    const ctx = await setup();
    await createUser(ctx.db, {
      email: "other@example.com",
      password: PASSWORD,
    });
    const other = await login(ctx.app, "other@example.com", PASSWORD);
    const theirs = await createMonitor(other, "Their secret server");
    await ctx.app.inject({ method: "GET", url: `${theirs.hb}?msg=theirs` });
    await other.submit("/settings", "/settings/webhooks", {
      name: "Their hook",
      url: "https://theirs.example.com/hook",
      secret: "",
    });
    await createMonitor(ctx.browser, "Mine");

    const res = await exportData(ctx.browser);
    expect(res.body).not.toContain("other@example.com");
    expect(res.body).not.toContain("Their");
    expect(res.body).not.toContain("theirs");
    const data = JSON.parse(res.body) as Export;
    expect(data.monitors.map((m) => m.name)).toEqual(["Mine"]);
    expect(data.alertChannels).toEqual([]);
  });

  it("holds the User's Plan when Plans are on", async () => {
    const ctx = await buildTestApp({ plansEnabled: true });
    await createUser(ctx.db, { email: "me@example.com", password: PASSWORD });
    const proUntil = new Date(ctx.clock.now().getTime() + 60 * MIN);
    await ctx.db
      .collection("users")
      .updateOne(
        { email: "me@example.com" },
        { $set: { plan: { proUntil, source: "comp", proEndedAt: null } } },
      );
    const browser = await login(ctx.app, "me@example.com", PASSWORD);
    const data = JSON.parse((await exportData(browser)).body) as Export;
    expect(data.user.plan).toEqual({
      proUntil: proUntil.toISOString(),
      source: "comp",
      proEndedAt: null,
    });
  });

  it("gives a User with no Monitors a valid file", async () => {
    const ctx = await setup();
    const res = await exportData(ctx.browser);
    const data = JSON.parse(res.body) as Export;
    expect(data.monitors).toEqual([]);
    expect(data.alertChannels).toEqual([]);
  });

  it("needs a CSRF token and a login", async () => {
    const ctx = await setup();
    const forged = await ctx.browser.submit(
      "/settings",
      "/settings/export",
      {},
      { csrf: null },
    );
    expect(forged.statusCode).toBe(403);
    const anon = await ctx.app.inject({
      method: "POST",
      url: "/settings/export",
    });
    expect(anon.statusCode).not.toBe(200);
  });
});
