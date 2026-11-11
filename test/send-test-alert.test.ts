import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  testConfig,
  type Browser,
  type TestContext,
} from "./helpers.js";

const GROUP_CHAT = { id: -2002, type: "group", title: "Garden project" };

let updateId = 0;

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

/** Links GROUP_CHAT to the User behind `browser` with a fresh Link code. */
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
        chat: GROUP_CHAT,
        date: 0,
        text: `/start ${code}`,
      },
    },
  });
  ctx.telegram.sent.length = 0;
}

/** The "Send test" form actions on the Settings page, one per Alert channel. */
async function testActionsOf(browser: Browser): Promise<string[]> {
  const body = (await browser.get("/settings")).body;
  return [...body.matchAll(/<form method="post" action="([^"]+\/test)"/g)].map(
    (m) => m[1]!,
  );
}

const flashOf = async (browser: Browser) =>
  /<p class="flash"[^>]*>([^<]*)<\/p>/.exec(
    (await browser.get("/settings")).body,
  )?.[1];

describe("Send test", () => {
  it("delivers a test Alert to a Linked chat straight away", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const [action] = await testActionsOf(ctx.browser);

    const res = await ctx.browser.submit("/settings", action!);

    expect(res.statusCode).toBe(303);
    expect(ctx.telegram.sent.map((s) => s.chatId)).toEqual([GROUP_CHAT.id]);
    expect(ctx.telegram.sent[0]!.text).toContain("Test Alert");
    expect(await flashOf(ctx.browser)).toBe(
      "Test Alert sent to Garden project.",
    );
  });

  it("shows why a failed send didn't get through, and doesn't retry it", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const [action] = await testActionsOf(ctx.browser);
    ctx.telegram.failingChats.add(GROUP_CHAT.id);

    await ctx.browser.submit("/settings", action!);
    expect(await flashOf(ctx.browser)).toBe(
      "Test Alert to Garden project failed: Error: telegram unavailable",
    );

    ctx.telegram.failingChats.clear();
    ctx.clock.advance(60 * 60 * 1000);
    await ctx.app.tick();
    expect(ctx.telegram.sent).toEqual([]);
  });

  it("clears Failing when it gets through", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const [action] = await testActionsOf(ctx.browser);
    const channels = ctx.db.collection("alertChannels");
    await channels.updateMany(
      {},
      { $set: { failingSince: ctx.clock.now(), lastError: "Error: down" } },
    );

    await ctx.browser.submit("/settings", action!);

    expect(
      await channels.findOne(
        {},
        { projection: { _id: 0, failingSince: 1, lastError: 1 } },
      ),
    ).toEqual({ failingSince: null, lastError: null });
  });

  it("refuses the 6th test in a minute", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const [action] = await testActionsOf(ctx.browser);
    for (let i = 0; i < 5; i++) {
      expect((await ctx.browser.submit("/settings", action!)).statusCode).toBe(
        303,
      );
    }

    const refused = await ctx.browser.submit("/settings", action!);
    expect(refused.statusCode).toBe(429);
    expect(refused.body).toContain("Too many test Alerts");
    expect(ctx.telegram.sent).toHaveLength(5);

    ctx.clock.advance(61 * 1000);
    expect((await ctx.browser.submit("/settings", action!)).statusCode).toBe(
      303,
    );
  });

  it("answers 404 for another User's Alert channel", async () => {
    const ctx = await loggedIn();
    await linkChat(ctx, ctx.browser);
    const [action] = await testActionsOf(ctx.browser);
    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");

    const res = await other.submit("/settings", action!);

    expect(res.statusCode).toBe(404);
    expect(ctx.telegram.sent).toEqual([]);
  });
});
