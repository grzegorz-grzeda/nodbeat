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
const TOKEN = "tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2";

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

function addNtfy(
  browser: Browser,
  fields: { name?: string; url: string; token?: string },
) {
  return browser.submit("/settings", "/settings/ntfy", {
    name: fields.name ?? "",
    url: fields.url,
    token: fields.token ?? "",
  });
}

/** The Alert channels list on the Settings page: each entry's raw HTML. */
async function channelItems(browser: Browser): Promise<string[]> {
  const body = (await browser.get("/settings")).body;
  const list = /<ul class="plain alert-channels">([\s\S]*?)<\/ul>/.exec(
    body,
  )?.[1];
  return [...(list ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
}

async function createMonitor(browser: Browser, name = "Garden sensor") {
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
  return { page, id: page.split("/").pop()!, hb };
}

async function goDown(ctx: TestContext, hb: string) {
  await ctx.app.inject({ method: "GET", url: hb });
  ctx.clock.advance(91 * SEC);
  await ctx.app.tick();
}

async function goUp(ctx: TestContext, hb: string) {
  await ctx.app.inject({ method: "GET", url: hb });
  await ctx.app.tick();
}

describe("ntfy topic", () => {
  it("gets a Down Alert at priority 5 and an Up Alert at priority 2, each linking to the Monitor, with the token", async () => {
    const ctx = await loggedIn();
    const res = await addNtfy(ctx.browser, {
      name: "Phone",
      url: "https://ntfy.sh/my-alerts",
      token: TOKEN,
    });
    expect(res.statusCode).toBe(303);
    const [item] = await channelItems(ctx.browser);
    expect(item).toContain("ntfy topic");
    expect(item).toContain('value="Phone"');
    expect(item).toContain("token set");
    expect((await ctx.browser.get("/settings")).body).not.toContain(TOKEN);

    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    ctx.clock.advance(5 * MIN);
    await goUp(ctx, m.hb);

    expect(ctx.http.requests).toHaveLength(2);
    const [down, up] = ctx.http.requests;
    expect(down!.url).toBe("https://ntfy.sh/my-alerts");
    expect(down!.timeoutMs).toBe(5 * SEC);
    expect(down!.headers).toMatchObject({
      title: "Garden sensor is Down",
      priority: "5",
      click: `https://nodbeat.test/monitors/${m.id}`,
      authorization: `Bearer ${TOKEN}`,
    });
    expect(down!.body).toContain("Since");
    expect(down!.body).not.toContain("<");
    expect(up!.headers).toMatchObject({
      title: "Garden sensor is Up again",
      priority: "2",
      click: `https://nodbeat.test/monitors/${m.id}`,
    });
    expect(up!.body).toContain("after 5 min");
  });

  it("sends no Authorization without a token, names itself after the topic, and carries a Fail signal's message as plain text", async () => {
    const ctx = await loggedIn();
    await addNtfy(ctx.browser, { url: "https://ntfy.example.org/servers" });
    const [item] = await channelItems(ctx.browser);
    expect(item).toContain('value="servers"');
    expect(item).toContain("no token");

    const m = await createMonitor(ctx.browser, "Bäckup <nightly>");
    await ctx.app.inject({
      method: "GET",
      url: `${m.hb}/fail?msg=disk+%26+tape+full`,
    });
    await ctx.app.tick();

    const [request] = ctx.http.requests;
    expect(request!.headers.authorization).toBeUndefined();
    // Not ASCII: RFC 2047 encoded, as ntfy decodes it.
    expect(request!.headers.title).toBe(
      `=?UTF-8?B?${Buffer.from("Bäckup <nightly> reported a failure").toString("base64")}?=`,
    );
    expect(request!.body).toContain("Message: disk & tape full");
  });

  it.each([
    ["loopback", "http://127.0.0.1/alerts"],
    ["a name resolving to 10.x", "https://internal.example.com/alerts"],
    ["no topic", "https://ntfy.sh/"],
  ])("refuses %s on save", async (_what, url) => {
    const ctx = await loggedIn();
    ctx.http.hosts.set("internal.example.com", ["10.1.2.3"]);

    const res = await addNtfy(ctx.browser, { url, token: TOKEN });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('class="error"');
    expect(res.body).not.toContain(TOKEN);
    expect(await channelItems(ctx.browser)).toEqual([]);
  });

  it("refuses a token that can't be sent in a header", async () => {
    const ctx = await loggedIn();
    const res = await addNtfy(ctx.browser, {
      url: "https://ntfy.sh/x",
      token: "two words",
    });
    expect(res.statusCode).toBe(400);
    expect(await channelItems(ctx.browser)).toEqual([]);
  });

  it("refuses to send once its host resolves to a private address, and marks it Failing", async () => {
    const ctx = await loggedIn();
    await addNtfy(ctx.browser, { url: "https://ntfy.home.example/alerts" });
    ctx.http.hosts.set("ntfy.home.example", ["192.168.1.20"]);
    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    for (let i = 0; i < 70; i++) {
      ctx.clock.advance(MIN);
      await ctx.app.tick();
    }

    expect(ctx.http.requests).toEqual([]);
    const [item] = await channelItems(ctx.browser);
    expect(item).toContain("Failing");
    expect(item).toContain("private");
  });

  it("is marked Failing after an hour of failures, and a delivered Alert clears it", async () => {
    const ctx = await loggedIn();
    await addNtfy(ctx.browser, { url: "https://ntfy.sh/x" });
    const m = await createMonitor(ctx.browser);
    ctx.http.respond = () => 429;
    await goDown(ctx, m.hb);
    ctx.clock.advance(61 * MIN);
    await ctx.app.tick();
    await ctx.app.tick();
    const [failing] = await channelItems(ctx.browser);
    expect(failing).toContain('class="badge badge-down">Failing');
    expect(failing).toContain("HTTP 429");

    ctx.http.respond = () => 200;
    await goUp(ctx, m.hb);
    expect(ctx.http.requests.at(-1)!.headers.priority).toBe("2");
    expect((await channelItems(ctx.browser))[0]).not.toContain("Failing");
  });

  it("can be edited: a new URL keeps the token unless removed, and the token is never shown", async () => {
    const ctx = await loggedIn();
    await addNtfy(ctx.browser, { url: "https://ntfy.sh/old", token: TOKEN });
    const editPath = /href="(\/settings\/channels\/[0-9a-f]+\/ntfy)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;
    const edit = (await ctx.browser.get(editPath)).body;
    expect(edit).toContain('value="https://ntfy.sh/old"');
    expect(edit).toContain("token set");
    expect(edit).not.toContain(TOKEN);

    const refused = await ctx.browser.submit(editPath, editPath, {
      url: "http://10.0.0.1/old",
    });
    expect(refused.statusCode).toBe(400);
    await ctx.browser.submit(editPath, editPath, {
      url: "https://ntfy.sh/new",
    });
    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    const [request] = ctx.http.requests;
    expect(request!.url).toBe("https://ntfy.sh/new");
    expect(request!.headers.authorization).toBe(`Bearer ${TOKEN}`);

    await ctx.browser.submit(editPath, editPath, {
      url: "https://ntfy.sh/new",
      removeToken: "1",
    });
    expect((await channelItems(ctx.browser))[0]).toContain("no token");
  });

  it("drops the token when the URL moves to another server and no new token is typed", async () => {
    const ctx = await loggedIn();
    await addNtfy(ctx.browser, {
      name: "Phone",
      url: "https://ntfy.sh/alerts",
      token: TOKEN,
    });
    const editPath = /href="(\/settings\/channels\/[0-9a-f]+\/ntfy)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;

    await ctx.browser.submit(editPath, editPath, {
      url: "https://ntfy.example.org/alerts",
    });

    const settings = (await ctx.browser.get("/settings")).body;
    expect(/<p class="flash"[^>]*>([^<]*)<\/p>/.exec(settings)?.[1]).toBe(
      "Phone saved. Its token was removed: the URL points at another host.",
    );
    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    expect(ctx.http.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('"Send test" pushes a test Alert with the token, at default priority', async () => {
    const ctx = await loggedIn();
    await addNtfy(ctx.browser, {
      name: "Phone",
      url: "https://ntfy.sh/x",
      token: TOKEN,
    });
    const testAction = /<form method="post" action="([^"]+\/test)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;

    await ctx.browser.submit("/settings", testAction);

    const flash = /<p class="flash"[^>]*>([^<]*)<\/p>/.exec(
      (await ctx.browser.get("/settings")).body,
    )?.[1];
    expect(flash).toBe("Test Alert sent to Phone.");
    const [request] = ctx.http.requests;
    expect(request!.headers).toMatchObject({
      title: "Test Alert from nodbeat",
      priority: "3",
      authorization: `Bearer ${TOKEN}`,
      click: "https://nodbeat.test/settings",
    });
    expect(request!.body).toBe("Alerts for your Monitors arrive here.");
  });
});
