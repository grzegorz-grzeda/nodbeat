import { describe, expect, it } from "vitest";
import {
  Browser,
  buildTestApp,
  createUser,
  login,
  testConfig,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;
const PASSWORD = "correct horse";

async function withUsers() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "admin@example.com",
    password: PASSWORD,
    admin: true,
  });
  await createUser(ctx.db, { email: "you@example.com", password: PASSWORD });
  const admin = await login(ctx.app, "admin@example.com", PASSWORD);
  const user = await login(ctx.app, "you@example.com", PASSWORD);
  return { ...ctx, admin, user };
}

async function createMonitor(
  browser: Browser,
  name = "Garden sensor",
  fields: Record<string, string> = {},
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name,
    interval: "60",
    intervalUnit: "s",
    grace: "30",
    graceUnit: "s",
    ...fields,
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

const heartbeat = (ctx: TestContext, hb: string, msg = "") =>
  ctx.app.inject({ method: "GET", url: msg ? `${hb}?msg=${msg}` : hb });

async function linkChat(ctx: TestContext, browser: Browser, chatId: number) {
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
      update_id: chatId,
      message: {
        chat: { id: chatId, type: "private", first_name: "Chat" },
        text: `/start ${code}`,
      },
    },
  });
}

/** The number in the row labelled `label` of the Admin page's tables. */
function stat(body: string, label: string): number | undefined {
  const escaped = label.replace(/[()]/g, "\\$&");
  const match = new RegExp(
    `<th scope="row">\\s*${escaped}\\s*</th>\\s*<td>\\s*(\\d+)\\s*</td>`,
  ).exec(body);
  return match ? Number(match[1]) : undefined;
}

/** The share (e.g. "25%") in the row labelled `label` of the Admin page's tables. */
function share(body: string, label: string): string | undefined {
  const escaped = label.replace(/[()]/g, "\\$&");
  return new RegExp(
    `<th scope="row">\\s*${escaped}\\s*</th>\\s*<td>\\s*\\d+\\s*</td>\\s*<td>\\s*([^<\\s]+)\\s*</td>`,
  ).exec(body)?.[1];
}

describe("Admin page", () => {
  it("doesn't exist for visitors and Users who aren't the Admin", async () => {
    const ctx = await withUsers();
    const unknown = await new Browser(ctx.app).get("/no-such-page");

    const visitor = await new Browser(ctx.app).get("/admin");
    expect(visitor.statusCode).toBe(404);
    expect(visitor.body).toBe(unknown.body);

    const asUser = await ctx.user.get("/admin");
    expect(asUser.statusCode).toBe(404);
    expect(asUser.body).toContain("Page not found");
    expect(asUser.body).not.toContain("Heartbeats (7 days)");
  });

  it("is linked from the nav only for the Admin", async () => {
    const ctx = await withUsers();
    expect((await ctx.admin.get("/")).body).toContain('href="/admin"');
    expect((await ctx.user.get("/")).body).not.toContain('href="/admin"');
  });

  it("shows totals for the whole instance", async () => {
    const ctx = await withUsers();
    const up = await createMonitor(ctx.admin, "Up one");
    await createMonitor(ctx.admin, "New one");
    const paused = await createMonitor(ctx.admin, "Paused one");
    await ctx.admin.submit(paused.page, `${paused.page}/pause`);
    const down = await createMonitor(ctx.user, "Down one");
    await linkChat(ctx, ctx.user, 1001);
    await linkChat(ctx, ctx.admin, 1002);

    await heartbeat(ctx, down.hb, "first");
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    await heartbeat(ctx, up.hb);

    const res = await ctx.admin.get("/admin");
    expect(res.statusCode).toBe(200);
    expect(stat(res.body, "Users")).toBe(2);
    expect(stat(res.body, "Monitors")).toBe(4);
    expect(stat(res.body, "New")).toBe(1);
    expect(stat(res.body, "Up")).toBe(1);
    expect(stat(res.body, "Down")).toBe(1);
    expect(stat(res.body, "Paused")).toBe(1);
    expect(stat(res.body, "Linked chats")).toBe(2);
    expect(stat(res.body, "Heartbeats (7 days)")).toBe(2);
    expect(stat(res.body, "Incidents (7 days)")).toBe(1);
    expect(stat(res.body, "Incidents (30 days)")).toBe(1);
  });

  it("counts only Heartbeats and Incidents inside each window", async () => {
    const ctx = await withUsers();
    const m = await createMonitor(ctx.user);
    await heartbeat(ctx, m.hb);
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();

    ctx.clock.advance(8 * DAY);
    const body = (await ctx.admin.get("/admin")).body;
    expect(stat(body, "Heartbeats (7 days)")).toBe(0);
    expect(stat(body, "Incidents (7 days)")).toBe(0);
    expect(stat(body, "Incidents (30 days)")).toBe(1);
  });

  it("never shows what Users watch", async () => {
    const ctx = await withUsers();
    const m = await createMonitor(ctx.user, "marker-name-7f3a");
    await heartbeat(ctx, m.hb, "marker-message-7f3a");

    const body = (await ctx.admin.get("/admin")).body;
    expect(body).not.toContain("marker-");
    expect(body).not.toContain("/hb/");
  });

  it("shows how Monitors are set up", async () => {
    const ctx = await withUsers();
    // 30 s, default Grace period (15 s), with notes.
    await createMonitor(ctx.user, "A", {
      interval: "30",
      grace: "",
      notes: "marker-note-7f3a",
    });
    // 5 min, custom Grace period, Alerts off.
    const b = await createMonitor(ctx.user, "B", {
      interval: "5",
      intervalUnit: "m",
      grace: "60",
    });
    await ctx.user.submit(b.page, `${b.page}/alerts`, {
      alertsEnabled: "false",
    });
    // 2 h, Grace period typed as the default (1 h), Paused, Alerts off.
    const c = await createMonitor(ctx.admin, "C", {
      interval: "2",
      intervalUnit: "h",
      grace: "1",
      graceUnit: "h",
    });
    await ctx.admin.submit(c.page, `${c.page}/pause`);
    await ctx.admin.submit(c.page, `${c.page}/alerts`, {
      alertsEnabled: "false",
    });
    // 3 days, 1 day Grace period: the default, since half the Interval is clamped to 1 day.
    await createMonitor(ctx.admin, "D", {
      interval: "3",
      intervalUnit: "d",
      grace: "1",
      graceUnit: "d",
    });

    const body = (await ctx.admin.get("/admin")).body;
    expect(stat(body, "≤ 1 min")).toBe(1);
    expect(stat(body, "≤ 5 min")).toBe(1);
    expect(stat(body, "≤ 1 h")).toBe(0);
    expect(stat(body, "≤ 1 day")).toBe(1);
    expect(stat(body, "&gt; 1 day")).toBe(1);
    expect(share(body, "≤ 1 min")).toBe("25%");
    expect(share(body, "≤ 1 h")).toBe("0%");
    expect(share(body, "&gt; 1 day")).toBe("25%");

    expect(stat(body, "Custom Grace period")).toBe(1);
    expect(share(body, "Custom Grace period")).toBe("25%");
    expect(stat(body, "With notes")).toBe(1);
    expect(share(body, "With notes")).toBe("25%");
    expect(stat(body, "Alerts off")).toBe(2);
    expect(share(body, "Alerts off")).toBe("50%");
    expect(stat(body, "Paused")).toBe(1);
    expect(share(body, "Paused")).toBe("25%");

    expect(body).not.toContain("marker-");
  });
});
