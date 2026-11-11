import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const MIN = 60 * 1000;
const PRIVATE_CHAT = { id: 1001, type: "private", first_name: "Grzegorz" };
const GROUP_CHAT = { id: -2002, type: "group", title: "Garden project" };
/** The Telegram user who sends messages in tests. */
const SENDER_ID = 4242;

type Chat = { id: number; type: string; title?: string; first_name?: string };

let updateId = 0;

function sendUpdate(ctx: TestContext, update: unknown) {
  return ctx.app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: {
      "x-telegram-bot-api-secret-token": testConfig.telegramWebhookSecret,
    },
    payload: update as Record<string, unknown>,
  });
}

/** Sends a text message to the bot from the given chat and returns the bot's replies to it. */
async function say(ctx: TestContext, chat: Chat, text: string) {
  const before = ctx.telegram.sent.length;
  const res = await sendUpdate(ctx, {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      chat,
      from: { id: SENDER_ID, is_bot: false, first_name: "Grzegorz" },
      date: 0,
      text,
    },
  });
  expect(res.statusCode).toBe(200);
  const replies = ctx.telegram.sent.slice(before);
  for (const r of replies) expect(r.chatId).toBe(chat.id);
  return replies.map((r) => r.text);
}

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

/** The Remove link of the Linked chat with this title on the Settings page; it posts to the same path. */
function removeActionFor(settingsBody: string, title: string): string {
  const item = settingsBody.split("<li>").find((li) => li.includes(title));
  const action = /href="(\/settings\/linked-chats\/[^"]+\/delete)"/.exec(
    item ?? "",
  )?.[1];
  expect(action).toBeDefined();
  return action!;
}

async function generateLinkCode(browser: Browser): Promise<string> {
  const res = await browser.submit("/settings", "/settings/link-code");
  expect(res.statusCode).toBe(303);
  const settings = await browser.get(res.headers.location as string);
  const code = /<code class="link-code">([A-Z0-9]{8})<\/code>/.exec(
    settings.body,
  )?.[1];
  expect(code).toBeDefined();
  return code!;
}

describe("Telegram webhook", () => {
  it("rejects requests without the matching secret-token header", async () => {
    const ctx = await buildTestApp();
    const update = { update_id: 1 };

    const missing = await ctx.app.inject({
      method: "POST",
      url: "/telegram/webhook",
      payload: update,
    });
    const wrong = await ctx.app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "nope" },
      payload: update,
    });

    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect((await sendUpdate(ctx, update)).statusCode).toBe(200);
  });
});

describe("linking a chat", () => {
  it("links a private chat with a Link code from the Settings page", async () => {
    const ctx = await loggedIn();
    const code = await generateLinkCode(ctx.browser);

    const replies = await say(ctx, PRIVATE_CHAT, `/start ${code}`);

    expect(replies).toEqual([
      "This chat is now linked to your nodbeat account. Alerts will arrive here.",
    ]);
    const settings = await ctx.browser.get("/settings");
    expect(settings.body).toContain("Grzegorz");
  });
});

describe("Link codes", () => {
  it("work only once", async () => {
    const ctx = await loggedIn();
    const code = await generateLinkCode(ctx.browser);
    await say(ctx, PRIVATE_CHAT, `/start ${code}`);

    const replies = await say(ctx, GROUP_CHAT, `/start ${code}`);

    expect(replies).toEqual([
      "That Link code is invalid, already used or expired. Generate a new one at https://nodbeat.test/settings.",
    ]);
    expect((await ctx.browser.get("/settings")).body).not.toContain(
      "Garden project",
    );
  });

  it("expire after 10 minutes", async () => {
    const ctx = await loggedIn();
    const stale = await generateLinkCode(ctx.browser);
    ctx.clock.advance(10 * MIN);
    expect(await say(ctx, PRIVATE_CHAT, `/start ${stale}`)).toEqual([
      "That Link code is invalid, already used or expired. Generate a new one at https://nodbeat.test/settings.",
    ]);
    expect((await ctx.browser.get("/settings")).body).not.toContain(stale);

    const fresh = await generateLinkCode(ctx.browser);
    ctx.clock.advance(10 * MIN - 1000);
    expect(await say(ctx, PRIVATE_CHAT, `/start ${fresh}`)).toEqual([
      "This chat is now linked to your nodbeat account. Alerts will arrive here.",
    ]);
  });

  it("stop working when a newer one is generated", async () => {
    const ctx = await loggedIn();
    const older = await generateLinkCode(ctx.browser);
    const newer = await generateLinkCode(ctx.browser);

    expect(await say(ctx, PRIVATE_CHAT, `/start ${older}`)).toEqual([
      expect.stringContaining("invalid, already used or expired"),
    ]);
    expect(await say(ctx, PRIVATE_CHAT, `/start ${newer}`)).toEqual([
      expect.stringContaining("now linked"),
    ]);
  });

  it("can be guessed only 10 times per chat in 10 minutes", async () => {
    const ctx = await loggedIn();
    for (let i = 0; i < 10; i++) {
      expect(await say(ctx, PRIVATE_CHAT, "/start AAAAAAAA")).toEqual([
        expect.stringContaining("invalid"),
      ]);
    }
    const code = await generateLinkCode(ctx.browser);

    expect(await say(ctx, PRIVATE_CHAT, `/start ${code}`)).toEqual([
      "Too many attempts. Try again in 10 min.",
    ]);
    ctx.clock.advance(10 * MIN);
    const fresh = await generateLinkCode(ctx.browser);
    expect(await say(ctx, PRIVATE_CHAT, `/start ${fresh}`)).toEqual([
      expect.stringContaining("now linked"),
    ]);
  });

  it("explains how to link when /start has no code", async () => {
    const ctx = await buildTestApp();
    expect(await say(ctx, PRIVATE_CHAT, "/start")).toEqual([
      "To link this chat: Generate a Link code at https://nodbeat.test/settings and send /start <code> here.",
    ]);
  });
});

describe("Linked chats", () => {
  it("can be several, including groups, and removed from the Settings page", async () => {
    const ctx = await loggedIn();
    await say(
      ctx,
      PRIVATE_CHAT,
      `/start ${await generateLinkCode(ctx.browser)}`,
    );
    await say(
      ctx,
      GROUP_CHAT,
      `/start@nodbeat_bot ${await generateLinkCode(ctx.browser)}`,
    );

    let settings = await ctx.browser.get("/settings");
    expect(settings.body).toContain("Grzegorz");
    expect(settings.body).toContain("Garden project");

    const removeAction = removeActionFor(settings.body, "Grzegorz");
    const confirm = await ctx.browser.get(removeAction);
    expect(confirm.body).toContain("Remove Grzegorz?");
    expect(confirm.body).toContain(`action="${removeAction}"`);
    const res = await ctx.browser.submit(removeAction, removeAction);
    expect(res.statusCode).toBe(303);

    settings = await ctx.browser.get("/settings");
    expect(settings.body).toContain(
      '<p class="flash" role="status">Grzegorz removed.</p>',
    );
    settings = await ctx.browser.get("/settings");
    expect(settings.body).not.toContain("Grzegorz");
    expect(settings.body).toContain("Garden project");
    expect(await say(ctx, PRIVATE_CHAT, "/status")).toEqual([
      expect.stringContaining("isn't linked"),
    ]);
  });

  it("cannot be removed by another User", async () => {
    const ctx = await loggedIn();
    await say(
      ctx,
      PRIVATE_CHAT,
      `/start ${await generateLinkCode(ctx.browser)}`,
    );
    const removeAction = removeActionFor(
      (await ctx.browser.get("/settings")).body,
      "Grzegorz",
    );

    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");
    await other.submit("/settings", removeAction);

    expect((await ctx.browser.get("/settings")).body).toContain("Grzegorz");
  });
});

describe("bot commands", () => {
  it("/status lists the owner's Monitors and their states", async () => {
    const ctx = await loggedIn();
    for (const name of ["Garden sensor", "Backup"]) {
      await ctx.browser.submit("/monitors/new", "/monitors", {
        name,
        interval: "5",
        intervalUnit: "m",
      });
    }
    const page = (await ctx.browser.get("/")).body;
    const monitorPath = /href="(\/monitors\/[0-9a-f]{24})"/.exec(page)![1]!;
    const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(
      (await ctx.browser.get(monitorPath)).body,
    )![1]!;
    await ctx.app.inject({ method: "GET", url: hb });
    ctx.clock.advance(2 * MIN);
    await say(ctx, GROUP_CHAT, `/start ${await generateLinkCode(ctx.browser)}`);
    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "administrator");

    expect(await say(ctx, GROUP_CHAT, "/status")).toEqual([
      "Garden sensor: Up (last Heartbeat 2 min ago)\nBackup: New (last Heartbeat never)",
    ]);
  });

  it("/status in a group linked by several Users shows each User's Monitors in numbered sections", async () => {
    const ctx = await loggedIn();
    await ctx.browser.submit("/monitors/new", "/monitors", {
      name: "Garden sensor",
      interval: "5",
      intervalUnit: "m",
    });
    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");
    await say(ctx, GROUP_CHAT, `/start ${await generateLinkCode(ctx.browser)}`);
    await say(ctx, GROUP_CHAT, `/start ${await generateLinkCode(other)}`);
    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "creator");

    expect(await say(ctx, GROUP_CHAT, "/status")).toEqual([
      "Account 1\nGarden sensor: New (last Heartbeat never)\n\nAccount 2\nNo Monitors yet.",
    ]);
  });

  it("/unlink removes the Linked chat", async () => {
    const ctx = await loggedIn();
    await say(ctx, GROUP_CHAT, `/start ${await generateLinkCode(ctx.browser)}`);
    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "administrator");

    expect(await say(ctx, GROUP_CHAT, "/unlink")).toEqual([
      "This chat is unlinked. No more Alerts will arrive here.",
    ]);
    expect((await ctx.browser.get("/settings")).body).not.toContain(
      "Garden project",
    );
  });

  it("/status and /unlink in a group answer only its Telegram admins", async () => {
    const ctx = await loggedIn();
    await ctx.browser.submit("/monitors/new", "/monitors", {
      name: "Garden sensor",
      interval: "5",
      intervalUnit: "m",
    });
    await say(ctx, GROUP_CHAT, `/start ${await generateLinkCode(ctx.browser)}`);
    const refusal = "Only group admins can use this command.";

    for (const status of ["member", "restricted", "left", "kicked"]) {
      ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, status);
      expect(await say(ctx, GROUP_CHAT, "/status")).toEqual([refusal]);
      expect(await say(ctx, GROUP_CHAT, "/unlink")).toEqual([refusal]);
    }
    expect((await ctx.browser.get("/settings")).body).toContain(
      "Garden project",
    );

    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "administrator");
    expect(await say(ctx, GROUP_CHAT, "/status")).toEqual([
      "Garden sensor: New (last Heartbeat never)",
    ]);
  });

  it("never shows an email in a bot reply", async () => {
    const ctx = await loggedIn();
    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");
    ctx.telegram.setChatMemberStatus(GROUP_CHAT.id, SENDER_ID, "administrator");

    const replies = [
      ...(await say(
        ctx,
        PRIVATE_CHAT,
        `/start ${await generateLinkCode(ctx.browser)}`,
      )),
      ...(await say(ctx, PRIVATE_CHAT, "/status")),
      ...(await say(
        ctx,
        GROUP_CHAT,
        `/start ${await generateLinkCode(ctx.browser)}`,
      )),
      ...(await say(
        ctx,
        GROUP_CHAT,
        `/start ${await generateLinkCode(other)}`,
      )),
      ...(await say(ctx, GROUP_CHAT, "/status")),
      ...(await say(ctx, GROUP_CHAT, "/unlink")),
      ...(await say(ctx, PRIVATE_CHAT, "/help")),
    ];

    expect(replies).toHaveLength(7);
    for (const reply of replies) expect(reply).not.toMatch(/@example\.com/);
  });

  it("/status and /unlink explain how to link in a chat that isn't linked", async () => {
    const ctx = await buildTestApp();
    const notLinked =
      "This chat isn't linked to a nodbeat account. Generate a Link code at https://nodbeat.test/settings and send /start <code> here.";

    expect(await say(ctx, PRIVATE_CHAT, "/status")).toEqual([notLinked]);
    expect(await say(ctx, PRIVATE_CHAT, "/unlink")).toEqual([notLinked]);
  });

  it("ignores plain messages and answers unknown commands with help only in private chats", async () => {
    const ctx = await buildTestApp();
    expect(await say(ctx, GROUP_CHAT, "hello everyone")).toEqual([]);
    expect(await say(ctx, GROUP_CHAT, "/weather@other_bot")).toEqual([]);
    expect(await say(ctx, PRIVATE_CHAT, "/help")).toEqual([
      expect.stringContaining("/status"),
    ]);
  });

  it("still acknowledges the Update when the reply can't be sent", async () => {
    const ctx = await buildTestApp();
    ctx.telegram.failing = true;
    expect(await say(ctx, PRIVATE_CHAT, "/status")).toEqual([]);
  });
});

describe("startup", () => {
  it("registers the webhook with Telegram", async () => {
    const ctx = await buildTestApp();
    expect(ctx.telegram.webhooks).toEqual([
      {
        url: "https://nodbeat.test/telegram/webhook",
        secretToken: testConfig.telegramWebhookSecret,
      },
    ]);
  });
});
