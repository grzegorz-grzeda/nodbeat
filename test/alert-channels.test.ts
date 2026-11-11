import { ObjectId } from "mongodb";
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

function sendUpdate(ctx: TestContext, update: Record<string, unknown>) {
  return ctx.app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: {
      "x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
    },
    payload: { update_id: ++updateId, ...update },
  });
}

/** Sends `/start <code>` from the chat and returns the bot's reply. */
async function start(ctx: TestContext, chat: Chat, code: string) {
  const before = ctx.telegram.sent.length;
  await sendUpdate(ctx, {
    message: { message_id: updateId, chat, date: 0, text: `/start ${code}` },
  });
  return ctx.telegram.sent.slice(before).map((s) => s.text);
}

async function generateLinkCode(browser: Browser): Promise<string> {
  const res = await browser.submit("/settings", "/settings/link-code");
  const settings = await browser.get(res.headers.location as string);
  return /<code class="link-code">([A-Z0-9]{8})<\/code>/.exec(
    settings.body,
  )![1]!;
}

async function linkChat(ctx: TestContext, browser: Browser, chat: Chat) {
  await start(ctx, chat, await generateLinkCode(browser));
  ctx.telegram.sent.length = 0;
}

/** The Alert channels list on the Settings page, one entry per channel: its kind and name. */
async function channelsOf(browser: Browser) {
  const body = (await browser.get("/settings")).body;
  const list = /<ul class="plain alert-channels">([\s\S]*?)<\/ul>/.exec(
    body,
  )?.[1];
  return [...(list ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => ({
    kind: /class="channel-kind"\s*>([^<]*)</.exec(m[1]!)?.[1],
    name: /name="name"\s+value="([^"]*)"/.exec(m[1]!)?.[1],
    rename: /<form method="post" action="([^"]+\/rename)"/.exec(m[1]!)?.[1],
    remove: /href="([^"]+\/delete)"/.exec(m[1]!)?.[1],
  }));
}

async function createMonitor(browser: Browser) {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Garden sensor",
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

/** A Linked chat as nodbeat stored it before Alert channels existed. */
async function insertLegacyLinkedChat(ctx: TestContext, chat: Chat) {
  const owner = await ctx.db
    .collection("users")
    .findOne({ email: "me@example.com" });
  await ctx.db.collection("linkedChats").insertOne({
    _id: new ObjectId(),
    ownerId: owner!._id,
    chatId: chat.id,
    title: chat.title ?? chat.first_name,
    linkedAt: ctx.clock.now(),
  });
}

describe("Alert channels", () => {
  it("are migrated from Linked chats at startup and keep receiving Down and Up Alerts", async () => {
    const ctx = await loggedIn();
    await insertLegacyLinkedChat(ctx, GROUP_CHAT);
    await restartApp(ctx);
    // A second startup changes nothing.
    const app = await restartApp(ctx);
    const browser = await login(app, "me@example.com", "correct horse");
    expect(
      (await channelsOf(browser)).map(({ kind, name }) => ({ kind, name })),
    ).toEqual([{ kind: "Linked chat", name: "Garden project" }]);

    const m = await createMonitor(browser);
    await app.inject({ method: "GET", url: m.hb });
    ctx.clock.advance(91 * SEC);
    await app.tick();
    await app.inject({ method: "GET", url: m.hb });
    await app.tick();

    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([
      GROUP_CHAT.id,
      GROUP_CHAT.id,
    ]);
    expect(ctx.telegram.sent[0]!.text).toContain("is Down");
    expect(ctx.telegram.sent[1]!.text).toContain("is Up again");
  });

  it("deliver an Alert queued before the migration", async () => {
    const ctx = await loggedIn();
    await insertLegacyLinkedChat(ctx, GROUP_CHAT);
    const owner = await ctx.db
      .collection("users")
      .findOne({ email: "me@example.com" });
    await ctx.db.collection("alertOutbox").insertOne({
      _id: new ObjectId(),
      monitorId: new ObjectId(),
      ownerId: owner!._id,
      kind: "down",
      incidentId: new ObjectId(),
      text: "Garden sensor is Down",
      chatIds: [GROUP_CHAT.id],
      attempts: 0,
      createdAt: ctx.clock.now(),
      firstFailedAt: null,
      nextAttemptAt: ctx.clock.now(),
    });

    const app = await restartApp(ctx);
    await app.tick();

    expect(ctx.telegram.sent.map((s) => [s.chatId, s.text])).toEqual([
      [GROUP_CHAT.id, "Garden sensor is Down"],
    ]);
  });

  it("are listed together in Settings with kind and name", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    await linkChat(ctx, ctx.browser, GROUP_CHAT);

    const channels = await channelsOf(ctx.browser);

    expect(channels.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "Linked chat", name: "Grzegorz" },
      { kind: "Linked chat", name: "Garden project" },
    ]);
  });

  it("can be renamed, and linking the chat again keeps the new name", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const [channel] = await channelsOf(ctx.browser);

    const res = await ctx.browser.submit("/settings", channel!.rename!, {
      name: "  Family  ",
    });
    expect(res.statusCode).toBe(303);
    expect((await ctx.browser.get("/settings")).body).toContain(
      '<p class="flash" role="status">Renamed to Family.</p>',
    );
    await linkChat(ctx, ctx.browser, GROUP_CHAT);

    expect((await channelsOf(ctx.browser)).map((c) => c.name)).toEqual([
      "Family",
    ]);
  });

  it("refuse an empty name", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const [channel] = await channelsOf(ctx.browser);

    const res = await ctx.browser.submit("/settings", channel!.rename!, {
      name: "   ",
    });

    expect(res.statusCode).toBe(400);
    expect((await channelsOf(ctx.browser)).map((c) => c.name)).toEqual([
      "Garden project",
    ]);
  });

  it("can't be renamed or removed by another User", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    const [channel] = await channelsOf(ctx.browser);
    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");

    await other.submit("/settings", channel!.rename!, { name: "Mine" });
    await other.submit("/settings", channel!.remove!);

    expect((await channelsOf(ctx.browser)).map((c) => c.name)).toEqual([
      "Garden project",
    ]);
  });

  it("can be removed in Settings, which stops its Alerts", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser, GROUP_CHAT);
    await linkChat(ctx, ctx.browser, PRIVATE_CHAT);
    const [group] = await channelsOf(ctx.browser);

    const confirm = await ctx.browser.get(group!.remove!);
    expect(confirm.body).toContain("Remove Garden project?");
    await ctx.browser.submit(group!.remove!, group!.remove!);

    expect((await channelsOf(ctx.browser)).map((c) => c.name)).toEqual([
      "Grzegorz",
    ]);
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: m.hb });
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([PRIVATE_CHAT.id]);
  });

  describe("limit", () => {
    const LIMIT = 10;
    const chat = (i: number): Chat => ({
      id: -5000 - i,
      type: "group",
      title: `Group ${i}`,
    });

    it("refuses linking a chat beyond the per-User limit, but relinking a Linked chat still works", async () => {
      const ctx = await loggedIn();
      for (let i = 0; i < LIMIT; i++) {
        await linkChat(ctx, ctx.browser, chat(i));
      }
      // Past the hourly Link code limit.
      ctx.clock.advance(60 * 60 * SEC);

      const refused = await start(
        ctx,
        chat(LIMIT),
        await generateLinkCode(ctx.browser),
      );
      const relinked = await start(
        ctx,
        chat(0),
        await generateLinkCode(ctx.browser),
      );

      expect(refused).toEqual([
        `You already have ${LIMIT} Alert channels, the most allowed. Remove one at https://nodbeat.test/settings first.`,
      ]);
      expect(relinked).toEqual([
        "This chat is now linked to your nodbeat account. Alerts will arrive here.",
      ]);
      expect(await channelsOf(ctx.browser)).toHaveLength(LIMIT);
    });

    it("can't be passed with parallel requests", async () => {
      const ctx = await loggedIn();
      for (let i = 0; i < LIMIT - 1; i++) {
        await linkChat(ctx, ctx.browser, chat(i));
      }
      const code = await generateLinkCode(ctx.browser);

      await Promise.all(
        [LIMIT, LIMIT + 1, LIMIT + 2].map((i) => start(ctx, chat(i), code)),
      );

      expect(await channelsOf(ctx.browser)).toHaveLength(LIMIT);
    });
  });
});
