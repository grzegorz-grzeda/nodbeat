import { createHmac } from "node:crypto";
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
const SECRET = "s3cret-for-signing";

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

function addWebhook(
  browser: Browser,
  fields: { name?: string; url: string; secret?: string },
) {
  return browser.submit("/settings", "/settings/webhooks", {
    name: fields.name ?? "",
    url: fields.url,
    secret: fields.secret ?? "",
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
  return { page, id: page.split("/").pop()!, hb };
}

/** Makes the Monitor Down (missed deadline) and dispatches the Down Alert. */
async function goDown(ctx: TestContext, hb: string) {
  await ctx.app.inject({ method: "GET", url: hb });
  ctx.clock.advance(91 * SEC);
  await ctx.app.tick();
}

async function goUp(ctx: TestContext, hb: string) {
  await ctx.app.inject({ method: "GET", url: hb });
  await ctx.app.tick();
}

const bodies = (ctx: TestContext) =>
  ctx.http.requests.map((r) => JSON.parse(r.body) as Record<string, unknown>);

describe("Webhook channel", () => {
  it("gets a signed Down Alert whose signature verifies, and the secret is never shown again", async () => {
    const ctx = await loggedIn();
    const res = await addWebhook(ctx.browser, {
      name: "Home Assistant",
      url: "https://hooks.example.com/nodbeat",
      secret: SECRET,
    });
    expect(res.statusCode).toBe(303);

    const [item] = await channelItems(ctx.browser);
    expect(item).toContain("Webhook");
    expect(item).toContain('value="Home Assistant"');
    const settings = (await ctx.browser.get("/settings")).body;
    expect(settings).not.toContain(SECRET);

    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);

    expect(ctx.http.requests).toHaveLength(1);
    const [request] = ctx.http.requests;
    expect(request!.url).toBe("https://hooks.example.com/nodbeat");
    expect(request!.headers["content-type"]).toBe("application/json");
    const expected = createHmac("sha256", SECRET)
      .update(request!.body)
      .digest("hex");
    expect(request!.headers["x-nodbeat-signature"]).toBe(`sha256=${expected}`);
    expect(request!.timeoutMs).toBe(5 * SEC);
    const body = JSON.parse(request!.body) as Record<string, unknown>;
    expect(body).toEqual({
      monitor: {
        id: m.id,
        name: "Garden sensor",
        url: `https://nodbeat.test/monitors/${m.id}`,
      },
      kind: "down",
      at: "2026-01-01T00:01:30.000Z",
      message: null,
      incidentId: expect.stringMatching(/^[0-9a-f]{24}$/),
    });
  });

  it("gets an unsigned Up Alert with the same Incident when it has no secret, named after its host", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, { url: "http://n8n.example.org/hook" });
    const [item] = await channelItems(ctx.browser);
    expect(item).toContain('value="n8n.example.org"');
    expect(item).toContain("no secret");

    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    ctx.clock.advance(5 * MIN);
    await goUp(ctx, m.hb);

    expect(
      ctx.http.requests.map((r) => r.headers["x-nodbeat-signature"]),
    ).toEqual([undefined, undefined]);
    const [down, up] = bodies(ctx);
    expect(up).toMatchObject({
      kind: "up",
      at: "2026-01-01T00:06:31.000Z",
      message: null,
      incidentId: down!.incidentId,
    });
  });

  it("carries a Fail signal's message", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, { url: "https://hooks.example.com/x" });
    const m = await createMonitor(ctx.browser);
    await ctx.app.inject({ method: "GET", url: `${m.hb}/fail?msg=disk+full` });
    await ctx.app.tick();

    expect(bodies(ctx)).toMatchObject([{ kind: "down", message: "disk full" }]);
  });

  it.each([
    ["loopback", "http://127.0.0.1/hook"],
    ["loopback v6", "http://[::1]:8080/hook"],
    ["a name resolving to 10.x", "https://internal.example.com/hook"],
    ["link-local (cloud metadata)", "http://169.254.169.254/latest"],
    ["CGNAT", "https://100.64.0.7/hook"],
    ["unique-local v6", "https://[fd12:3456::1]/hook"],
    ["private mapped into v6", "https://[::ffff:192.168.1.1]/hook"],
    ["private through NAT64", "https://[64:ff9b::a00:1]/hook"],
    ["private through 6to4", "https://[2002:a00:1::1]/hook"],
    ["Teredo", "https://[2001:0:4136:e378::1]/hook"],
    ["TEST-NET-1", "https://192.0.2.10/hook"],
    ["TEST-NET-2", "https://198.51.100.10/hook"],
    ["TEST-NET-3", "https://203.0.113.10/hook"],
    ['"this network"', "https://0.1.2.3/hook"],
    ["reserved", "https://240.1.2.3/hook"],
    ["broadcast", "https://255.255.255.255/hook"],
    ["not http", "ftp://hooks.example.com/hook"],
  ])("refuses %s on save", async (_what, url) => {
    const ctx = await loggedIn();
    ctx.http.hosts.set("internal.example.com", ["203.0.113.5", "10.1.2.3"]);

    const res = await addWebhook(ctx.browser, { url, secret: SECRET });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('class="error"');
    expect(res.body).not.toContain(SECRET);
    expect(await channelItems(ctx.browser)).toEqual([]);
  });

  it("says why when a name resolves to a reserved address, or to none", async () => {
    const ctx = await loggedIn();
    ctx.http.hosts.set("internal.example.com", ["10.1.2.3"]);
    ctx.http.hosts.set("nowhere.example.com", []);

    const reserved = await addWebhook(ctx.browser, {
      url: "https://internal.example.com/hook",
    });
    expect(reserved.body).toContain(
      "internal.example.com resolves to a private or reserved address.",
    );
    const none = await addWebhook(ctx.browser, {
      url: "https://nowhere.example.com/hook",
    });
    expect(none.body).toContain("nowhere.example.com has no address.");
  });

  it("refuses to send once its host resolves to a private address, and marks it Failing", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, { url: "https://flaky.example.com/hook" });
    ctx.http.hosts.set("flaky.example.com", ["10.0.0.5"]);
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

  it("is marked Failing with the last error after an hour of failures, keeps getting Alerts, and a delivered one clears it", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, {
      name: "Receiver",
      url: "https://hooks.example.com/x",
    });
    const m = await createMonitor(ctx.browser);
    ctx.http.respond = () => 503;
    await goDown(ctx, m.hb);
    ctx.clock.advance(30 * MIN);
    await ctx.app.tick();
    expect((await channelItems(ctx.browser))[0]).not.toContain("Failing");

    ctx.clock.advance(31 * MIN);
    await ctx.app.tick();
    await ctx.app.tick();
    const [failing] = await channelItems(ctx.browser);
    expect(failing).toContain('class="badge badge-down">Failing');
    expect(failing).toContain("HTTP 503");

    ctx.http.respond = () => 204;
    await goUp(ctx, m.hb);
    expect(bodies(ctx).at(-1)).toMatchObject({ kind: "up" });
    expect((await channelItems(ctx.browser))[0]).not.toContain("Failing");
  });

  it("doesn't follow a redirect: it counts as a failure and is retried", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, { url: "https://hooks.example.com/x" });
    const m = await createMonitor(ctx.browser);
    const answers = [302, 200];
    ctx.http.respond = () => answers.shift()!;
    await goDown(ctx, m.hb);
    expect(ctx.http.requests).toHaveLength(1);
    ctx.clock.advance(30 * SEC);
    await ctx.app.tick();

    expect(bodies(ctx).map((b) => b.kind)).toEqual(["down", "down"]);
  });

  it("can be edited: a new URL on the same host keeps the secret unless removed, and the secret is never shown", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, {
      url: "https://old.example.com/x",
      secret: SECRET,
    });
    const editPath = /href="(\/settings\/channels\/[0-9a-f]+\/webhook)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;
    const edit = (await ctx.browser.get(editPath)).body;
    expect(edit).toContain('value="https://old.example.com/x"');
    expect(edit).toContain("secret set");
    expect(edit).not.toContain(SECRET);

    const refused = await ctx.browser.submit(editPath, editPath, {
      url: "http://192.168.0.10/x",
    });
    expect(refused.statusCode).toBe(400);
    await ctx.browser.submit(editPath, editPath, {
      url: "https://old.example.com/new",
    });
    const m = await createMonitor(ctx.browser);
    await goDown(ctx, m.hb);
    const [signed] = ctx.http.requests;
    expect(signed!.url).toBe("https://old.example.com/new");
    expect(signed!.headers["x-nodbeat-signature"]).toBe(
      `sha256=${createHmac("sha256", SECRET).update(signed!.body).digest("hex")}`,
    );

    await ctx.browser.submit(editPath, editPath, {
      url: "https://old.example.com/new",
      removeSecret: "1",
    });
    expect((await channelItems(ctx.browser))[0]).toContain("no secret");
  });

  it("drops the secret when the URL moves to another host and no new secret is typed", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, {
      name: "Receiver",
      url: "https://old.example.com/x",
      secret: SECRET,
    });
    const editPath = /href="(\/settings\/channels\/[0-9a-f]+\/webhook)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;

    await ctx.browser.submit(editPath, editPath, {
      url: "https://elsewhere.example.net/x",
    });

    const settings = (await ctx.browser.get("/settings")).body;
    expect(/<p class="flash"[^>]*>([^<]*)<\/p>/.exec(settings)?.[1]).toBe(
      "Receiver saved. Its secret was removed: the URL points at another host.",
    );
    expect((await channelItems(ctx.browser))[0]).toContain("no secret");

    // A new secret typed with the move is kept.
    await ctx.browser.submit(editPath, editPath, {
      url: "https://third.example.org/x",
      secret: "another-secret",
    });
    expect((await channelItems(ctx.browser))[0]).toContain("secret set");
  });

  it('"Send test" POSTs a signed test Alert, shows a failure, and clears Failing once it gets through', async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, {
      name: "Receiver",
      url: "https://hooks.example.com/x",
      secret: SECRET,
    });
    const m = await createMonitor(ctx.browser);
    ctx.http.respond = () => 500;
    await goDown(ctx, m.hb);
    ctx.clock.advance(61 * MIN);
    await ctx.app.tick();
    const testAction = /<form method="post" action="([^"]+\/test)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;
    const flash = async () =>
      /<p class="flash"[^>]*>([^<]*)<\/p>/.exec(
        (await ctx.browser.get("/settings")).body,
      )?.[1];

    await ctx.browser.submit("/settings", testAction);
    expect(await flash()).toBe("Test Alert to Receiver failed: HTTP 500");

    ctx.http.requests.length = 0;
    ctx.http.respond = () => 200;
    await ctx.browser.submit("/settings", testAction);
    expect(await flash()).toBe("Test Alert sent to Receiver.");
    const [request] = ctx.http.requests;
    expect(request!.headers["x-nodbeat-signature"]).toBe(
      `sha256=${createHmac("sha256", SECRET).update(request!.body).digest("hex")}`,
    );
    expect(JSON.parse(request!.body)).toMatchObject({
      kind: "test",
      message: expect.stringContaining("Test Alert"),
    });
    expect((await channelItems(ctx.browser))[0]).not.toContain("Failing");
  });

  it("can't be edited by another User", async () => {
    const ctx = await loggedIn();
    await addWebhook(ctx.browser, { url: "https://mine.example.com/x" });
    const editPath = /href="(\/settings\/channels\/[0-9a-f]+\/webhook)"/.exec(
      (await channelItems(ctx.browser))[0]!,
    )![1]!;
    await createUser(ctx.db, {
      email: "other@example.com",
      password: "correct horse",
    });
    const other = await login(ctx.app, "other@example.com", "correct horse");

    expect((await other.get(editPath)).statusCode).toBe(303);
    await other.submit("/settings", editPath, {
      url: "https://theirs.example.com/x",
    });

    expect((await channelItems(ctx.browser))[0]).toContain(
      "https://mine.example.com/x",
    );
  });
});
