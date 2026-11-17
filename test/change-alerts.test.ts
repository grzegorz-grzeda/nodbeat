import { describe, expect, it } from "vitest";
import {
  transition,
  type MonitorSettings,
  type MonitorStateFields,
} from "../src/monitor-state.js";
import {
  buildTestApp,
  createUser,
  login,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const NOW = new Date("2026-01-01T00:00:40Z");

function monitor(
  fields: Partial<MonitorStateFields> = {},
  settings: Partial<MonitorSettings> = {},
): MonitorStateFields & MonitorSettings {
  return {
    state: "up",
    lastHeartbeatAt: new Date("2026-01-01T00:00:00Z"),
    lastMessage: "door=open",
    pausedAt: null,
    watchedSince: null,
    runStartedAt: null,
    lastRunDurationSec: null,
    changeBaseline: "door=open",
    intervalSec: 60,
    graceSec: 30,
    alertsEnabled: true,
    changeAlerts: true,
    ...fields,
    ...settings,
  } as MonitorStateFields & MonitorSettings;
}

const heartbeat = (message: string | null) =>
  ({ kind: "heartbeat", message }) as const;

const CHANGE = {
  kind: "enqueue-change-alert",
  previousMessage: "door=open",
  message: "door=closed",
};

describe("transition: Change Alerts", () => {
  it("alerts when an Up Monitor's message differs from the baseline, and moves the baseline", () => {
    const { fields, effects } = transition(
      monitor(),
      heartbeat("door=closed"),
      NOW,
    );
    expect(fields.changeBaseline).toBe("door=closed");
    expect(effects).toEqual([CHANGE]);
  });

  it("sends nothing for the same message", () => {
    const { effects } = transition(monitor(), heartbeat("door=open"), NOW);
    expect(effects).toEqual([]);
  });

  it("ignores a Heartbeat without a message, keeping the baseline", () => {
    const { fields, effects } = transition(monitor(), heartbeat(null), NOW);
    expect(fields.changeBaseline).toBe("door=open");
    expect(fields.lastMessage).toBeNull();
    expect(effects).toEqual([]);
  });

  it("only sets the baseline for the first message, also on Monitors stored before Change Alerts", () => {
    for (const baseline of [{ changeBaseline: null }, {}]) {
      const m = monitor();
      delete m.changeBaseline;
      const { fields, effects } = transition(
        { ...m, ...baseline },
        heartbeat("door=closed"),
        NOW,
      );
      expect(fields.changeBaseline).toBe("door=closed");
      expect(effects).toEqual([]);
    }
  });

  it("moves the baseline silently when switched off, Alerts are off, or Paused", () => {
    for (const m of [
      monitor({}, { changeAlerts: false }),
      monitor({}, { alertsEnabled: false }),
      monitor({ state: "paused", pausedAt: NOW }),
    ]) {
      const { fields, effects } = transition(m, heartbeat("door=closed"), NOW);
      expect(fields.changeBaseline).toBe("door=closed");
      expect(effects).toEqual([]);
    }
  });

  it("ignores Fail signal messages", () => {
    const { fields, effects } = transition(
      monitor(),
      { kind: "fail", message: "door=jammed" },
      NOW,
    );
    expect(fields.changeBaseline).toBe("door=open");
    expect(effects).not.toContainEqual(
      expect.objectContaining({ kind: "enqueue-change-alert" }),
    );
  });

  it("sends the Up Alert before the Change Alert when a Heartbeat brings the Monitor Up", () => {
    const { effects } = transition(
      monitor({ state: "down" }),
      heartbeat("door=closed"),
      NOW,
    );
    expect(effects).toEqual([
      { kind: "close-incident", reason: "heartbeat" },
      { kind: "enqueue-alert", alert: "up" },
      CHANGE,
    ]);
  });

  it("alerts on a New Monitor's first Heartbeat if a baseline is already known", () => {
    const { effects } = transition(
      monitor({ state: "new", lastHeartbeatAt: null }),
      heartbeat("door=closed"),
      NOW,
    );
    expect(effects).toEqual([{ kind: "end-period", state: "new" }, CHANGE]);
  });
});

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
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

async function createMonitor(browser: Browser, changeAlerts: boolean) {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Garage door",
    interval: "1",
    intervalUnit: "h",
    grace: "30",
    graceUnit: "m",
    ...(changeAlerts && { changeAlerts: "true" }),
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, id: page.split("/").pop()!, hb, body };
}

/** Sends a Heartbeat (with `msg` unless null) a little later than the last, and dispatches Alerts. */
async function send(ctx: TestContext, hb: string, msg: string | null) {
  ctx.clock.advance(2 * SEC);
  const url = msg === null ? hb : `${hb}?msg=${encodeURIComponent(msg)}`;
  const res = await ctx.app.inject({ method: "GET", url });
  expect(res.statusCode).toBe(200);
  await ctx.app.tick();
}

const shown = (text: string) => text.replace(/<[^>]*>/g, "");

describe("Change Alerts", () => {
  it("sends one Change Alert old → new to Telegram, ntfy and a Webhook", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    await ctx.browser.submit("/settings", "/settings/ntfy", {
      name: "Phone",
      url: "https://ntfy.sh/garage",
      token: "",
    });
    await ctx.browser.submit("/settings", "/settings/webhooks", {
      name: "Hook",
      url: "https://hooks.example.com/nodbeat",
      secret: "",
    });
    const m = await createMonitor(ctx.browser, true);
    expect(m.body).toContain("Change Alerts: on");

    for (const msg of ["door=open", "door=open", null, "door=closed"]) {
      await send(ctx, m.hb, msg);
    }

    expect(ctx.telegram.sent).toHaveLength(1);
    const [tg] = ctx.telegram.sent;
    expect(shown(tg!.text)).toContain("🔄 Garage door has a new message");
    expect(shown(tg!.text)).toContain("door=open → door=closed");
    expect(tg!.options?.disableNotification).toBe(true);

    const ntfy = ctx.http.requests.filter((r) => r.url.includes("ntfy.sh"));
    expect(ntfy).toHaveLength(1);
    expect(ntfy[0]!.headers).toMatchObject({
      title: "Garage door has a new message",
      priority: "3",
      tags: "arrows_counterclockwise",
    });
    expect(ntfy[0]!.body).toContain("door=open → door=closed");

    const hooks = ctx.http.requests.filter((r) =>
      r.url.includes("hooks.example.com"),
    );
    expect(hooks).toHaveLength(1);
    expect(JSON.parse(hooks[0]!.body)).toEqual({
      monitor: {
        id: m.id,
        name: "Garage door",
        url: `https://nodbeat.test/monitors/${m.id}`,
      },
      kind: "change",
      at: "2026-01-01T00:00:08.000Z",
      message: "door=closed",
      previousMessage: "door=open",
      incidentId: null,
    });
  });

  it("sends nothing when the Monitor doesn't ask for Change Alerts", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser, false);
    expect(m.body).toContain("Change Alerts: off");
    await send(ctx, m.hb, "door=open");
    await send(ctx, m.hb, "door=closed");
    expect(ctx.telegram.sent).toHaveLength(0);
  });

  it("sends nothing for a change while Paused, nor after unpausing", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser, true);
    await send(ctx, m.hb, "door=open");
    await ctx.browser.submit(m.page, `${m.page}/pause`);
    await send(ctx, m.hb, "door=closed");
    await ctx.browser.submit(m.page, `${m.page}/unpause`);
    await send(ctx, m.hb, "door=closed");
    expect(ctx.telegram.sent).toHaveLength(0);
  });

  it("can be switched on and off on the edit form", async () => {
    const ctx = await loggedIn();
    const m = await createMonitor(ctx.browser, false);
    const edit = await ctx.browser.get(`${m.page}/edit`);
    expect(edit.body).toMatch(/name="changeAlerts"\s+value="true"\s+\/>/);
    await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "Garage door",
      interval: "1",
      intervalUnit: "h",
      grace: "30",
      graceUnit: "m",
      changeAlerts: "true",
    });
    expect((await ctx.browser.get(m.page)).body).toContain("Change Alerts: on");
    expect((await ctx.browser.get(`${m.page}/edit`)).body).toMatch(
      /name="changeAlerts"\s+value="true"\s+checked/,
    );
  });
});
