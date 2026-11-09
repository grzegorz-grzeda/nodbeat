import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, login, type Browser } from "./helpers.js";

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

async function createMonitor(
  browser: Browser,
  fields: Record<string, string>,
): Promise<string> {
  const res = await browser.submit("/monitors/new", "/monitors", fields);
  expect(res.statusCode).toBe(303);
  return res.headers.location as string;
}

function heartbeatUrl(body: string): string {
  const url = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)?.[1];
  expect(url).toBeDefined();
  return url!;
}

describe("creating a Monitor", () => {
  it("creates a New Monitor and shows its Heartbeat URL", async () => {
    const { browser } = await loggedIn();

    const location = await createMonitor(browser, {
      name: "Garden sensor",
      interval: "5",
      intervalUnit: "m",
      notes: "Behind the shed",
    });

    const monitorPage = await browser.get(location);
    expect(monitorPage.statusCode).toBe(200);
    expect(monitorPage.body).toContain("Garden sensor");
    expect(monitorPage.body).toContain("Behind the shed");
    expect(monitorPage.body).toContain("New");
    expect(monitorPage.body).toContain("Interval: 5 min");
    expect(monitorPage.body).toContain("Grace period: 2 min 30 s");
    const url = heartbeatUrl(monitorPage.body);
    expect(monitorPage.body).toContain(
      `curl -fsS -m 10 --retry 3 https://nodbeat.test${url}`,
    );
    expect(monitorPage.body).toContain("HTTPClient");
    expect(monitorPage.body).toContain("crontab");
  });

  it("uses the given Grace period", async () => {
    const { browser } = await loggedIn();

    const location = await createMonitor(browser, {
      name: "Backup",
      interval: "1",
      intervalUnit: "d",
      grace: "2",
      graceUnit: "h",
    });

    const monitorPage = await browser.get(location);
    expect(monitorPage.body).toContain("Interval: 1 d");
    expect(monitorPage.body).toContain("Grace period: 2 h");
  });

  it.each([
    [{ name: "", interval: "60", intervalUnit: "s" }, "Name is required"],
    [
      { name: "x", interval: "29", intervalUnit: "s" },
      "Interval must be between 30 s and 7 d",
    ],
    [
      { name: "x", interval: "8", intervalUnit: "d" },
      "Interval must be between 30 s and 7 d",
    ],
    [
      { name: "x", interval: "abc", intervalUnit: "s" },
      "Interval must be between 30 s and 7 d",
    ],
    [
      {
        name: "x",
        interval: "1",
        intervalUnit: "d",
        grace: "25",
        graceUnit: "h",
      },
      "Grace period must be between 0 s and 1 d",
    ],
  ])("rejects invalid input %o", async (fields, error) => {
    const { browser } = await loggedIn();

    const res = await browser.submit("/monitors/new", "/monitors", fields);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(error);
    expect((await browser.get("/")).body).toContain("No Monitors yet");
  });

  it("accepts a Grace period of 0", async () => {
    const { browser } = await loggedIn();

    const location = await createMonitor(browser, {
      name: "Strict",
      interval: "30",
      intervalUnit: "s",
      grace: "0",
      graceUnit: "s",
    });

    expect((await browser.get(location)).body).toContain("Grace period: 0 s");
  });

  it("stops at the maximum number of Monitors", async () => {
    const { browser } = await loggedIn();
    for (let i = 0; i < 50; i++) {
      await createMonitor(browser, {
        name: `m${i}`,
        interval: "60",
        intervalUnit: "s",
      });
    }

    const res = await browser.submit("/monitors/new", "/monitors", {
      name: "one too many",
      interval: "60",
      intervalUnit: "s",
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("You can have at most 50 Monitors");
  });

  it("requires login", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/monitors/new" });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
  });
});

describe("Heartbeat intake", () => {
  it("moves the Monitor from New to Up and shows the last Heartbeat on the Dashboard", async () => {
    const { app, browser, clock } = await loggedIn();
    const location = await createMonitor(browser, {
      name: "Garden sensor",
      interval: "60",
      intervalUnit: "s",
    });
    const url = heartbeatUrl((await browser.get(location)).body);
    expect((await browser.get("/")).body).toMatch(
      /Garden sensor[\s\S]*New[\s\S]*never/,
    );

    const res = await app.inject({
      method: "GET",
      url: `${url}?msg=battery%203.7V`,
    });
    clock.advance(42_000);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("OK");
    expect((await browser.get("/")).body).toMatch(
      /Garden sensor[\s\S]*Up[\s\S]*42 s ago[\s\S]*battery 3.7V/,
    );
  });

  it("accepts POST with a plain-text body, a JSON body or no content type", async () => {
    const { app, browser, clock } = await loggedIn();
    const url = heartbeatUrl(
      (
        await browser.get(
          await createMonitor(browser, {
            name: "m",
            interval: "60",
            intervalUnit: "s",
          }),
        )
      ).body,
    );

    const plain = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": "text/plain" },
      payload: "from text",
    });
    expect(plain.statusCode).toBe(200);
    expect((await browser.get("/")).body).toContain("from text");

    clock.advance(1_000);
    const json = await app.inject({
      method: "POST",
      url,
      payload: { msg: "from json" },
    });
    expect(json.statusCode).toBe(200);
    expect((await browser.get("/")).body).toContain("from json");

    clock.advance(1_000);
    const bare = await app.inject({
      method: "POST",
      url,
      payload: "from arduino",
    });
    expect(bare.statusCode).toBe(200);
    expect((await browser.get("/")).body).toContain("from arduino");

    clock.advance(1_000);
    const empty = await app.inject({ method: "POST", url });
    expect(empty.statusCode).toBe(200);
    expect((await browser.get("/")).body).not.toContain("from arduino");
  });

  it("accepts a JSON Content-Type with an empty or malformed body", async () => {
    const { app, browser, clock } = await loggedIn();
    const url = heartbeatUrl(
      (
        await browser.get(
          await createMonitor(browser, {
            name: "m",
            interval: "60",
            intervalUnit: "s",
          }),
        )
      ).body,
    );
    const json = { "content-type": "application/json" };

    const empty = await app.inject({
      method: "POST",
      url,
      headers: json,
      payload: "",
    });
    clock.advance(1_000);
    const broken = await app.inject({
      method: "POST",
      url,
      headers: json,
      payload: "{oops",
    });

    expect(empty.statusCode).toBe(200);
    expect(broken.statusCode).toBe(200);
    expect((await browser.get("/")).body).toMatch(/Up[\s\S]*\{oops/);
  });

  it("truncates the message to 200 characters", async () => {
    const { app, browser } = await loggedIn();
    const url = heartbeatUrl(
      (
        await browser.get(
          await createMonitor(browser, {
            name: "m",
            interval: "60",
            intervalUnit: "s",
          }),
        )
      ).body,
    );

    await app.inject({
      method: "GET",
      url: `${url}?msg=${"a".repeat(199)}bXYZ`,
    });

    const dashboard = (await browser.get("/")).body;
    expect(dashboard).toContain(`${"a".repeat(199)}b<`);
    expect(dashboard).not.toContain("bX");
  });

  it("escapes the message on the Dashboard", async () => {
    const { app, browser } = await loggedIn();
    const url = heartbeatUrl(
      (
        await browser.get(
          await createMonitor(browser, {
            name: "m",
            interval: "60",
            intervalUnit: "s",
          }),
        )
      ).body,
    );

    await app.inject({
      method: "GET",
      url: `${url}?msg=${encodeURIComponent("<script>")}`,
    });

    const dashboard = (await browser.get("/")).body;
    expect(dashboard).toContain("&lt;script&gt;");
    expect(dashboard).not.toContain("<script>");
  });

  it("answers 404 for an unknown token", async () => {
    const { app } = await buildTestApp();

    const get = await app.inject({ method: "GET", url: "/hb/nope" });
    const post = await app.inject({
      method: "POST",
      url: "/hb/nope",
      payload: "x",
    });

    expect(get.statusCode).toBe(404);
    expect(post.statusCode).toBe(404);
  });

  it("answers 429 to more than 1 Heartbeat per second per token", async () => {
    const { app, browser, clock } = await loggedIn();
    const one = heartbeatUrl(
      (
        await browser.get(
          await createMonitor(browser, {
            name: "one",
            interval: "60",
            intervalUnit: "s",
          }),
        )
      ).body,
    );
    const two = heartbeatUrl(
      (
        await browser.get(
          await createMonitor(browser, {
            name: "two",
            interval: "60",
            intervalUnit: "s",
          }),
        )
      ).body,
    );

    expect(
      (await app.inject({ method: "GET", url: `${one}?msg=first` })).statusCode,
    ).toBe(200);
    clock.advance(999);
    expect(
      (await app.inject({ method: "GET", url: `${one}?msg=flood` })).statusCode,
    ).toBe(429);
    expect((await app.inject({ method: "GET", url: two })).statusCode).toBe(
      200,
    );
    clock.advance(1);
    expect(
      (await app.inject({ method: "GET", url: `${one}?msg=later` })).statusCode,
    ).toBe(200);

    const dashboard = (await browser.get("/")).body;
    expect(dashboard).not.toContain("flood");
    expect(dashboard).toContain("later");
  });

  it("keeps raw Heartbeats for 7 days via a TTL index", async () => {
    const { db } = await buildTestApp();

    const indexes = await db.collection("heartbeats").indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { receivedAt: 1 },
        expireAfterSeconds: 7 * 24 * 60 * 60,
      }),
    );
  });
});

describe("ownership", () => {
  it("doesn't let a User see another User's Monitors", async () => {
    const alice = await loggedIn("alice@example.com");
    await createUser(alice.db, {
      email: "bob@example.com",
      password: "correct horse",
    });
    const bob = await login(alice.app, "bob@example.com", "correct horse");
    const location = await createMonitor(alice.browser, {
      name: "Alice's secret",
      interval: "60",
      intervalUnit: "s",
    });

    const bobDashboard = await bob.get("/");
    const bobView = await bob.get(location);

    expect(bobDashboard.body).not.toContain("secret");
    expect(bobDashboard.body).toContain("No Monitors yet");
    expect(bobView.statusCode).toBe(404);
    expect(bobView.body).not.toContain("/hb/");
    expect((await alice.browser.get("/")).body).toContain("Alice&#39;s secret");
  });

  it("answers 404 for a malformed Monitor id", async () => {
    const { browser } = await loggedIn();

    expect((await browser.get("/monitors/not-an-id")).statusCode).toBe(404);
  });
});
