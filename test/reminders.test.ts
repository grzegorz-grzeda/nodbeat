import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  restartApp,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const PRIVATE_CHAT = { id: 1001, type: "private", first_name: "Grzegorz" };

let updateId = 0;

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

/** Links a Telegram chat the way a User does: Link code + `/start <code>`. */
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
      update_id: ++updateId,
      message: {
        message_id: updateId,
        chat: PRIVATE_CHAT,
        date: 0,
        text: `/start ${code}`,
      },
    },
  });
  ctx.telegram.sent.length = 0;
}

const FORM = {
  name: "Freezer sensor",
  interval: "60",
  intervalUnit: "s",
  grace: "30",
  graceUnit: "s",
};

/** Creates a Monitor (Interval 60 s, Grace period 30 s) with the given Reminder cadence ("" = Never). */
async function createMonitor(browser: Browser, reminderEvery = "3600") {
  const res = await browser.submit("/monitors/new", "/monitors", {
    ...FORM,
    reminderEvery,
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

/** Sends a Heartbeat with a message and lets the Monitor miss its deadline: Down at the returned time. */
async function goDown(ctx: TestContext, hb: string): Promise<number> {
  await ctx.app.inject({ method: "GET", url: `${hb}?msg=-18%C2%B0C` });
  ctx.clock.advance(90 * SEC);
  await ctx.app.tick();
  return ctx.clock.now().getTime();
}

/** Moves the clock to `ms` after `from` and ticks. */
async function tickAt(ctx: TestContext, from: number, ms: number) {
  ctx.clock.advance(from + ms - ctx.clock.now().getTime());
  await ctx.app.tick();
}

/** An Alert's text as the chat shows it: Telegram HTML tags dropped. */
const shown = (text: string) => text.replace(/<[^>]*>/g, "");

/** The Telegram messages sent so far that are Reminders. */
const reminders = (ctx: TestContext) =>
  ctx.telegram.sent.filter((m) => shown(m.text).includes("is still Down"));

describe("Reminders", () => {
  it("repeat the Down Alert every hour while Down, loud, with the Down duration and last message; Up stops them", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    expect(ctx.telegram.sent).toHaveLength(1);

    await tickAt(ctx, downAt, HOUR - SEC);
    expect(reminders(ctx)).toHaveLength(0);

    await tickAt(ctx, downAt, HOUR);
    expect(reminders(ctx)).toHaveLength(1);
    const first = reminders(ctx)[0]!;
    const lines = shown(first.text).split("\n");
    expect(lines[0]).toBe("🔴 Freezer sensor is still Down");
    expect(lines[1]).toBe(
      "Down for 1 h, since 2026-01-01 01:01:30 (Europe/Warsaw)",
    );
    expect(lines).toContain("Last message: -18°C");
    expect(first.options.disableNotification).toBe(false);

    await tickAt(ctx, downAt, 2 * HOUR);
    expect(reminders(ctx)).toHaveLength(2);
    expect(shown(reminders(ctx)[1]!.text)).toContain("Down for 2 h");

    // Up at 2.5 h: no Reminders after (the Monitor goes Down again 90 s later, a new Incident due a Reminder at 3.5 h
    // + 90 s).
    await tickAt(ctx, downAt, 2.5 * HOUR);
    await ctx.app.inject({ method: "GET", url: m.hb });
    await ctx.app.tick();
    for (const h of [3, 3.5]) await tickAt(ctx, downAt, h * HOUR);
    expect(reminders(ctx)).toHaveLength(2);
  });

  it("are off by default: the forms offer Never and 1 h / 6 h / 24 h, and a Monitor left on Never isn't reminded", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const form = (await ctx.browser.get("/monitors/new")).body;
    const select = /<select name="reminderEvery">([\s\S]*?)<\/select>/.exec(
      form,
    )![1]!;
    const options = [
      ...select.matchAll(
        /<option\s+value="(\d*)"\s*(selected)?\s*>\s*([^<]*?)\s*</g,
      ),
    ].map((o) => [o[1], o[2] ?? "", o[3]]);
    expect(options).toEqual([
      ["", "selected", "Never"],
      ["3600", "", "Remind me every 1 h while Down"],
      ["21600", "", "Remind me every 6 h while Down"],
      ["86400", "", "Remind me every 24 h while Down"],
    ]);

    const res = await ctx.browser.submit("/monitors/new", "/monitors", FORM);
    const page = res.headers.location as string;
    const body = (await ctx.browser.get(page)).body;
    expect(body).toContain("Reminders: never");
    const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
    const downAt = await goDown(ctx, hb);
    for (const h of [1, 2, 3]) await tickAt(ctx, downAt, h * HOUR);
    expect(ctx.telegram.sent).toHaveLength(1);
    expect(reminders(ctx)).toHaveLength(0);
  });

  it("refuses any other cadence, and the edit form shows the chosen one", async () => {
    const ctx = await loggedIn();
    const bad = await ctx.browser.submit("/monitors/new", "/monitors", {
      ...FORM,
      reminderEvery: "60",
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain(
      "Reminders must be every 1 h, 6 h or 24 h, or never.",
    );

    const m = await createMonitor(ctx.browser, "21600");
    expect((await ctx.browser.get(m.page)).body).toContain(
      "Reminders: every 6 h while Down",
    );
    const edit = (await ctx.browser.get(`${m.page}/edit`)).body;
    expect(edit).toMatch(/<option\s+value="21600"\s+selected\s*>/);
  });

  it("stop when the Monitor is paused", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    await tickAt(ctx, downAt, HOUR);
    expect(reminders(ctx)).toHaveLength(1);

    await tickAt(ctx, downAt, 1.5 * HOUR);
    await ctx.browser.submit(m.page, `${m.page}/pause`);
    for (const h of [2, 3, 4]) await tickAt(ctx, downAt, h * HOUR);
    expect(reminders(ctx)).toHaveLength(1);
  });

  it("switched on while Down count from the switch, not from going Down", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser, "");
    const downAt = await goDown(ctx, m.hb);
    await tickAt(ctx, downAt, HOUR);

    // 11:20 when Down since 10:00.
    await tickAt(ctx, downAt, 80 * MIN);
    await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      ...FORM,
      reminderEvery: "3600",
    });
    await tickAt(ctx, downAt, 2 * HOUR);
    expect(reminders(ctx)).toHaveLength(0);
    await tickAt(ctx, downAt, 140 * MIN);
    expect(reminders(ctx)).toHaveLength(1);
    expect(shown(reminders(ctx)[0]!.text)).toContain("Down for 2 h 20 min");
  });

  it("recompute the next Reminder from a cadence change while Down; other edits keep the timing", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);

    // A rename at 0.5 h changes nothing: the Reminder is still due at 1 h.
    await tickAt(ctx, downAt, 0.5 * HOUR);
    await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      ...FORM,
      name: "Freezer",
      reminderEvery: "3600",
    });
    await tickAt(ctx, downAt, HOUR);
    expect(reminders(ctx)).toHaveLength(1);

    // 6 h from 1.5 h: due at 7.5 h.
    await tickAt(ctx, downAt, 1.5 * HOUR);
    await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      ...FORM,
      reminderEvery: "21600",
    });
    for (const h of [2, 3, 7]) await tickAt(ctx, downAt, h * HOUR);
    expect(reminders(ctx)).toHaveLength(1);
    await tickAt(ctx, downAt, 7.5 * HOUR);
    expect(reminders(ctx)).toHaveLength(2);

    // Never: no more.
    await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, FORM);
    await tickAt(ctx, downAt, 13.5 * HOUR);
    expect(reminders(ctx)).toHaveLength(2);
  });

  it("send one Reminder for the times missed while nodbeat wasn't running, then keep the cadence", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    await tickAt(ctx, downAt, HOUR);
    expect(reminders(ctx)).toHaveLength(1);

    // nodbeat down from 11:00 to 15:00.
    ctx.clock.advance(4 * HOUR);
    ctx.app = await restartApp(ctx);
    await ctx.app.tick();
    await ctx.app.tick();
    expect(reminders(ctx)).toHaveLength(2);
    expect(shown(reminders(ctx)[1]!.text)).toContain("Down for 5 h");

    await tickAt(ctx, downAt, 5.5 * HOUR);
    expect(reminders(ctx)).toHaveLength(2);
    await tickAt(ctx, downAt, 6 * HOUR);
    expect(reminders(ctx)).toHaveLength(3);
  });

  it("aren't moved by Fail signals during the Down, which send no Alerts either", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    for (let t = 5 * MIN; t < HOUR; t += 5 * MIN) {
      await tickAt(ctx, downAt, t);
      await ctx.app.inject({ method: "GET", url: `${m.hb}/fail?msg=E42` });
      await ctx.app.tick();
    }
    expect(ctx.telegram.sent).toHaveLength(1);
    await tickAt(ctx, downAt, HOUR);
    expect(ctx.telegram.sent).toHaveLength(2);
    expect(reminders(ctx)).toHaveLength(1);
    expect(shown(reminders(ctx)[0]!.text)).toContain("Last message: E42");
    await tickAt(ctx, downAt, 2 * HOUR);
    expect(reminders(ctx)).toHaveLength(2);
  });

  it("go to a Webhook with kind reminder, the Incident's start and the last message", async () => {
    const ctx = await loggedIn();
    await ctx.browser.submit("/settings", "/settings/webhooks", {
      name: "",
      url: "https://hooks.example.com/nodbeat",
      secret: "",
    });
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    await tickAt(ctx, downAt, HOUR);

    const bodies = ctx.http.requests.map(
      (r) => JSON.parse(r.body) as Record<string, unknown>,
    );
    expect(bodies.map((b) => b.kind)).toEqual(["down", "reminder"]);
    expect(bodies[1]).toMatchObject({
      monitor: { name: "Freezer sensor" },
      at: new Date(downAt).toISOString(),
      message: "-18°C",
      incidentId: bodies[0]!.incidentId,
    });
  });

  it("go to an ntfy topic at priority 5", async () => {
    const ctx = await loggedIn();
    await ctx.browser.submit("/settings", "/settings/ntfy", {
      name: "Phone",
      url: "https://ntfy.sh/my-alerts",
      token: "",
    });
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    await tickAt(ctx, downAt, HOUR);

    expect(ctx.http.requests).toHaveLength(2);
    const reminder = ctx.http.requests[1]!;
    expect(reminder.headers).toMatchObject({
      title: "Freezer sensor is still Down",
      priority: "5",
    });
    expect(reminder.body).toContain("Down for 1 h");
  });

  it("queued when the Monitor comes Up or Alerts are switched off are dropped", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    let downAt = await goDown(ctx, m.hb);

    // Telegram fails: the Reminder waits in the outbox, then the Monitor comes Up.
    ctx.telegram.failing = true;
    await tickAt(ctx, downAt, HOUR);
    await ctx.app.inject({ method: "GET", url: m.hb });
    ctx.telegram.failing = false;
    ctx.clock.advance(MIN);
    await ctx.app.tick();
    expect(reminders(ctx)).toHaveLength(0);
    expect(shown(ctx.telegram.sent.at(-1)!.text)).toContain("is Up again");

    // Down again; a queued Reminder, then Alerts off.
    downAt = ctx.clock.now().getTime() + 30 * SEC;
    await tickAt(ctx, downAt, 0);
    ctx.telegram.failing = true;
    await tickAt(ctx, downAt, HOUR);
    await ctx.browser.submit(m.page, `${m.page}/alerts`, {
      alertsEnabled: "false",
    });
    ctx.telegram.failing = false;
    for (const h of [1.1, 2, 3]) await tickAt(ctx, downAt, h * HOUR);
    expect(reminders(ctx)).toHaveLength(0);
  });

  it("are counted per Incident in the Incidents log", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const m = await createMonitor(ctx.browser);
    const downAt = await goDown(ctx, m.hb);
    for (const h of [1, 2]) await tickAt(ctx, downAt, h * HOUR);

    for (const path of [m.page, `${m.page}/incidents`]) {
      const body = (await ctx.browser.get(path)).body;
      expect(body).toContain("<th>Reminders</th>");
      expect(body).toMatch(/<td class="reminders">\s*2\s*<\/td>/);
    }
  });
});
