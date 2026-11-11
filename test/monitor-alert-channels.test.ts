import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const SENDER_ID = 4242;
const PRIVATE_CHAT = { id: 1001, type: "private", first_name: "Grzegorz" };
const GROUP_CHAT = { id: -2002, type: "group", title: "Garden project" };

type Chat = { id: number; type: string; title?: string; first_name?: string };

let updateId = 0;

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

/** Sends a message from the chat and returns the bot's replies. */
async function say(ctx: TestContext, chat: Chat, text: string) {
  const before = ctx.telegram.sent.length;
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
        chat,
        from: { id: SENDER_ID, is_bot: false, first_name: "Grzegorz" },
        date: 0,
        text,
      },
    },
  });
  return ctx.telegram.sent.slice(before).map((s) => s.text);
}

async function linkChat(ctx: TestContext, browser: Browser, chat: Chat) {
  const res = await browser.submit("/settings", "/settings/link-code");
  const settings = await browser.get(res.headers.location as string);
  const code = /<code class="link-code">([A-Z0-9]{8})<\/code>/.exec(
    settings.body,
  )![1]!;
  await say(ctx, chat, `/start ${code}`);
  ctx.telegram.sent.length = 0;
}

/** The Alert channel ids the Monitor form offers, by channel name. */
async function channelIds(browser: Browser): Promise<Record<string, string>> {
  const body = (await browser.get("/monitors/new")).body;
  return Object.fromEntries(
    [
      ...body.matchAll(
        /name="alertChannelIds"\s+value="([0-9a-f]{24})"[^>]*\/?>\s*([^<]+?)\s*</g,
      ),
    ].map((m) => [m[2]!, m[1]!]),
  );
}

/** Creates a Monitor alerting `channels` ("all" when omitted) and returns its page and Heartbeat path. */
async function createMonitor(
  browser: Browser,
  name: string,
  channels?: string[],
) {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name,
    interval: "60",
    intervalUnit: "s",
    grace: "30",
    graceUnit: "s",
    ...(channels
      ? { alertChannels: "chosen", alertChannelIds: channels }
      : { alertChannels: "all" }),
  });
  expect(res.statusCode).toBe(303);
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

/** Sends a Heartbeat, lets the Monitor go Down and sends the Alerts. Returns the chats alerted. */
async function goDown(ctx: TestContext, hbs: string[]) {
  for (const hb of hbs) await ctx.app.inject({ method: "GET", url: hb });
  ctx.clock.advance(91 * SEC);
  await ctx.app.tick();
  return ctx.telegram.sent.map((s) => s.chatId);
}

async function removeChannel(browser: Browser, id: string) {
  const path = `/settings/channels/${id}/delete`;
  await browser.submit(path, path);
}

describe("Monitor's Alert channels", () => {
  it("a Monitor alerting one of two channels sends only there", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const ids = await channelIds(ctx.browser);
    const m = await createMonitor(ctx.browser, "Garden sensor", [
      ids["Garden project"]!,
    ]);

    expect(await goDown(ctx, [m.hb])).toEqual([GROUP_CHAT.id]);
    expect((await ctx.browser.get(m.page)).body).toMatch(
      /Alert channels:\s*Garden project/,
    );
  });

  it("existing and new Monitors alert all channels unless chosen", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const m = await createMonitor(ctx.browser, "Garden sensor");
    // A Monitor stored before Alert channels could be chosen.
    await ctx.db
      .collection("monitors")
      .updateOne({ name: "Garden sensor" }, { $unset: { alertChannels: "" } });

    expect(await goDown(ctx, [m.hb])).toEqual([PRIVATE_CHAT.id]);
    expect((await ctx.browser.get(m.page)).body).toMatch(
      /Alert channels:\s*All/,
    );
  });

  it("a channel added later gets Alerts from all-channel Monitors only", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const ids = await channelIds(ctx.browser);
    const all = await createMonitor(ctx.browser, "Server");
    const chosen = await createMonitor(ctx.browser, "Garden sensor", [
      ids["Grzegorz"]!,
    ]);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);

    await goDown(ctx, [all.hb, chosen.hb]);

    const sent = ctx.telegram.sent.map((s) => [
      s.chatId,
      /<b>([^<]+)<\/b>/.exec(s.text)![1],
    ]);
    expect(sent).toHaveLength(3);
    expect(sent).toEqual(
      expect.arrayContaining([
        [PRIVATE_CHAT.id, "Server"],
        [GROUP_CHAT.id, "Server"],
        [PRIVATE_CHAT.id, "Garden sensor"],
      ]),
    );
  });

  it("removing the only chosen channel says Alerts go nowhere and sends nothing", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const ids = await channelIds(ctx.browser);
    const m = await createMonitor(ctx.browser, "Garden sensor", [
      ids["Garden project"]!,
    ]);
    const other = await createMonitor(ctx.browser, "Server");

    await removeChannel(ctx.browser, ids["Garden project"]!);

    const page = (await ctx.browser.get(m.page)).body;
    expect(page).toContain("Alerts go nowhere");
    // The emptied list stays chosen: it doesn't fall back to all channels.
    expect(page).toMatch(/Alert channels:\s*none/);
    expect((await ctx.browser.get(other.page)).body).not.toContain(
      "Alerts go nowhere",
    );
    const dashboard = (await ctx.browser.get("/")).body;
    expect(dashboard.match(/Alerts go nowhere/g)).toHaveLength(1);
    const json = (await ctx.browser.get("/dashboard.json")).json() as {
      monitors: Array<{ name: string; alertsGoNowhere: boolean }>;
    };
    expect(
      json.monitors.map(({ name, alertsGoNowhere }) => [name, alertsGoNowhere]),
    ).toEqual([
      ["Garden sensor", true],
      ["Server", false],
    ]);
    expect(await goDown(ctx, [m.hb])).toEqual([]);
    const edit = (await ctx.browser.get(`${m.page}/edit`)).body;
    expect(edit).toMatch(/value="chosen"\s+checked/);
  });

  it("the edit form changes and shows the chosen channels", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const ids = await channelIds(ctx.browser);
    const m = await createMonitor(ctx.browser, "Garden sensor");

    const res = await ctx.browser.submit(`${m.page}/edit`, `${m.page}/edit`, {
      name: "Garden sensor",
      interval: "60",
      intervalUnit: "s",
      grace: "30",
      graceUnit: "s",
      alertChannels: "chosen",
      alertChannelIds: [ids["Grzegorz"]!],
    });
    expect(res.statusCode).toBe(303);

    const edit = (await ctx.browser.get(`${m.page}/edit`)).body;
    expect(edit).toMatch(new RegExp(`value="${ids["Grzegorz"]}"\\s+checked`));
    expect(edit).not.toMatch(
      new RegExp(`value="${ids["Garden project"]}"\\s+checked`),
    );
    expect(await goDown(ctx, [m.hb])).toEqual([PRIVATE_CHAT.id]);
  });

  it("another User's channel id is rejected by the form", async () => {
    const ctx = await loggedIn();
    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");
    await linkChat(ctx, other, GROUP_CHAT);
    const theirs = (await channelIds(other))["Garden project"]!;

    const res = await ctx.browser.submit("/monitors/new", "/monitors", {
      name: "Garden sensor",
      interval: "60",
      intervalUnit: "s",
      alertChannels: "chosen",
      alertChannelIds: [theirs],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Choose only your own Alert channels.");
    expect(await ctx.db.collection("monitors").countDocuments()).toBe(0);
  });

  it("a group's /status lists only the Monitors alerting it", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const ids = await channelIds(ctx.browser);
    await createMonitor(ctx.browser, "Garden sensor", [ids["Garden project"]!]);
    await createMonitor(ctx.browser, "Server", [ids["Grzegorz"]!]);
    await createMonitor(ctx.browser, "Router");
    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "administrator");

    expect(await say(ctx, GROUP_CHAT, "/status")).toEqual([
      "Garden sensor: New (last Heartbeat never)\nRouter: New (last Heartbeat never)",
    ]);
    expect(await say(ctx, PRIVATE_CHAT, "/status")).toEqual([
      "Server: New (last Heartbeat never)\nRouter: New (last Heartbeat never)",
    ]);
  });

  it("/status says so when no Monitor alerts the chat", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const ids = await channelIds(ctx.browser);
    await createMonitor(ctx.browser, "Server", [ids["Grzegorz"]!]);
    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "administrator");

    expect(await say(ctx, GROUP_CHAT, "/status")).toEqual([
      "No Monitors alert this chat.",
    ]);
  });
});
