import { describe, expect, it } from "vitest";
import {
  Browser,
  buildTestApp,
  createUser,
  login,
  testConfig,
} from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

async function appWithUser() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
  });
  return ctx;
}

describe("login", () => {
  it("logs in with the right password and shows the empty Dashboard", async () => {
    const { app } = await appWithUser();

    const browser = await login(app, "me@example.com", "correct horse");

    expect(browser.lastResponse.statusCode).toBe(303);
    expect(browser.lastResponse.headers.location).toBe("/");
    const dashboard = await browser.get("/");
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body).toContain("No Monitors yet");
    expect(dashboard.body).toContain("me@example.com");
  });

  it("accepts the email in any case", async () => {
    const { app } = await appWithUser();

    const browser = await login(app, "  Me@Example.COM ", "correct horse");

    expect(browser.lastResponse.statusCode).toBe(303);
  });

  it("sets an HttpOnly, Secure, SameSite=Lax session cookie lasting 30 days", async () => {
    const { app } = await appWithUser();

    const browser = await login(app, "me@example.com", "correct horse");

    const cookie = browser.lastResponse.cookies.find(
      (c) => c.name === "nb_session",
    );
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it("rejects a wrong password", async () => {
    const { app } = await appWithUser();

    const browser = await login(app, "me@example.com", "wrong horse");

    expect(browser.lastResponse.statusCode).toBe(401);
    expect(browser.lastResponse.body).toContain("Wrong email or password");
    expect((await browser.get("/settings")).headers.location).toBe("/login");
  });

  it("rejects an unknown email the same way", async () => {
    const { app } = await appWithUser();

    const browser = await login(app, "nobody@example.com", "correct horse");

    expect(browser.lastResponse.statusCode).toBe(401);
    expect(browser.lastResponse.body).toContain("Wrong email or password");
  });

  it("rejects the 6th attempt from one IP within 15 minutes, even with the right password", async () => {
    const { app, clock } = await appWithUser();
    const browser = new Browser(app, "198.51.100.7");
    for (let i = 0; i < 5; i++) {
      await login(app, "me@example.com", "wrong horse", browser);
      expect(browser.lastResponse.statusCode).toBe(401);
    }

    await login(app, "me@example.com", "correct horse", browser);
    expect(browser.lastResponse.statusCode).toBe(429);

    const otherIp = await login(
      app,
      "me@example.com",
      "correct horse",
      new Browser(app, "198.51.100.8"),
    );
    expect(otherIp.lastResponse.statusCode).toBe(303);

    clock.advance(15 * MINUTE + 1);
    await login(app, "me@example.com", "correct horse", browser);
    expect(browser.lastResponse.statusCode).toBe(303);
  });

  it("limits by the client IP the edge Caddy forwards, not its own", async () => {
    const { app } = await appWithUser();
    const caddy = testConfig.trustedProxyIp;
    const client = (ip: string) =>
      new Browser(app, caddy, { "x-forwarded-for": ip });
    const attacker = client("198.51.100.7");
    for (let i = 0; i < 5; i++) {
      await login(app, "me@example.com", "wrong horse", attacker);
    }

    await login(app, "me@example.com", "correct horse", attacker);
    expect(attacker.lastResponse.statusCode).toBe(429);
    const someoneElse = await login(
      app,
      "me@example.com",
      "correct horse",
      client("198.51.100.8"),
    );
    expect(someoneElse.lastResponse.statusCode).toBe(303);
    // A spoofed X-Forwarded-For entry in front of the real one doesn't help.
    const spoofing = await login(
      app,
      "me@example.com",
      "correct horse",
      client("10.9.9.9, 198.51.100.7"),
    );
    expect(spoofing.lastResponse.statusCode).toBe(429);
  });

  it("ignores X-Forwarded-For from any address but the edge Caddy", async () => {
    const { app } = await appWithUser();
    // Another container on the edge network, rotating forged client IPs.
    const forger = "172.18.0.9";
    for (let i = 0; i < 5; i++) {
      await login(
        app,
        "me@example.com",
        "wrong horse",
        new Browser(app, forger, { "x-forwarded-for": `198.51.100.${i}` }),
      );
    }

    const sixth = await login(
      app,
      "me@example.com",
      "correct horse",
      new Browser(app, forger, { "x-forwarded-for": "198.51.100.99" }),
    );
    expect(sixth.lastResponse.statusCode).toBe(429);
  });

  it("rejects a login form without a valid CSRF token", async () => {
    const { app } = await appWithUser();
    const browser = new Browser(app);
    await browser.get("/login");

    const missing = await browser.submit(
      "/login",
      "/login",
      { email: "me@example.com", password: "correct horse" },
      { csrf: null },
    );
    const forged = await browser.submit(
      "/login",
      "/login",
      { email: "me@example.com", password: "correct horse" },
      { csrf: "forged" },
    );

    expect(missing.statusCode).toBe(403);
    expect(forged.statusCode).toBe(403);
  });
});

describe("Dashboard access", () => {
  it("sends anonymous visitors to the login page", async () => {
    const { app } = await appWithUser();

    const res = await new Browser(app).get("/settings");

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
  });

  it("sends a logged-in User from the login page to the Dashboard", async () => {
    const { app } = await appWithUser();
    const browser = await login(app, "me@example.com", "correct horse");

    const res = await browser.get("/login");

    expect(res.headers.location).toBe("/");
  });
});

describe("sessions", () => {
  it("expire after 30 days without activity", async () => {
    const { app, clock } = await appWithUser();
    const browser = await login(app, "me@example.com", "correct horse");

    clock.advance(30 * DAY + 1);

    const res = await browser.get("/settings");
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
  });

  it("are extended by activity", async () => {
    const { app, clock } = await appWithUser();
    const browser = await login(app, "me@example.com", "correct horse");

    clock.advance(20 * DAY);
    expect((await browser.get("/")).statusCode).toBe(200);
    clock.advance(20 * DAY);

    expect((await browser.get("/")).statusCode).toBe(200);
  });
});

describe("logging in again", () => {
  it("ends the session the browser had before", async () => {
    const { app } = await appWithUser();
    const browser = await login(app, "me@example.com", "correct horse");
    const firstSession = browser.cookies.get("nb_session");

    await browser.submit("/", "/login", {
      email: "me@example.com",
      password: "correct horse",
    });

    expect(browser.cookies.get("nb_session")).not.toBe(firstSession);
    expect((await browser.get("/")).statusCode).toBe(200);
    browser.cookies.set("nb_session", firstSession!);
    expect((await browser.get("/settings")).headers.location).toBe("/login");
  });
});

describe("logout", () => {
  it("ends the session", async () => {
    const { app } = await appWithUser();
    const browser = await login(app, "me@example.com", "correct horse");
    const sessionCookie = browser.cookies.get("nb_session");

    const res = await browser.submit("/", "/logout");

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
    expect((await browser.get("/settings")).headers.location).toBe("/login");
    // Replaying the old cookie doesn't bring the session back.
    browser.cookies.set("nb_session", sessionCookie!);
    expect((await browser.get("/settings")).headers.location).toBe("/login");
  });

  it("requires a valid CSRF token", async () => {
    const { app } = await appWithUser();
    const browser = await login(app, "me@example.com", "correct horse");

    const res = await browser.submit("/", "/logout", {}, { csrf: "forged" });

    expect(res.statusCode).toBe(403);
    expect((await browser.get("/")).statusCode).toBe(200);
  });
});
