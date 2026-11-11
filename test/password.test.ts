import { describe, expect, it } from "vitest";
import { Browser, buildTestApp, createUser, login } from "./helpers.js";

const EMAIL = "me@example.com";
const PASSWORD = "correct horse";

async function twoSessions() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email: EMAIL, password: PASSWORD });
  const here = await login(ctx.app, EMAIL, PASSWORD);
  const elsewhere = await login(
    ctx.app,
    EMAIL,
    PASSWORD,
    new Browser(ctx.app, "198.51.100.20"),
  );
  return { ...ctx, here, elsewhere };
}

const changePassword = (
  browser: Browser,
  fields: Partial<Record<"current" | "password" | "confirm", string>> = {},
) =>
  browser.submit("/settings", "/settings/password", {
    current: PASSWORD,
    password: "battery staple",
    confirm: "battery staple",
    ...fields,
  });

const loggedIn = async (browser: Browser) =>
  (await browser.get("/settings")).statusCode === 200;

describe("Password change", () => {
  it("replaces the password and logs out every other session", async () => {
    const { app, here, elsewhere } = await twoSessions();
    expect((await here.get("/settings")).body).toContain(
      'action="/settings/password"',
    );

    const res = await changePassword(here);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/settings");
    expect((await here.get("/settings")).body).toContain("Password changed.");

    expect(await loggedIn(here)).toBe(true);
    expect(await loggedIn(elsewhere)).toBe(false);
    const old = await login(app, EMAIL, PASSWORD);
    expect(old.lastResponse.statusCode).toBe(401);
    const fresh = await login(app, EMAIL, "battery staple");
    expect(fresh.lastResponse.statusCode).toBe(303);
  });

  it.each([
    [{ current: "wrong horse" }, "Current password is wrong."],
    [{ password: "short", confirm: "short" }, "at least 8 characters"],
    [{ confirm: "battery stapler" }, "don&#39;t match"],
  ])("rejects %o with an error and changes nothing", async (fields, error) => {
    const { app, here, elsewhere } = await twoSessions();

    const res = await changePassword(here, fields);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(error);
    expect(res.body).toContain('action="/settings/password"');

    expect(await loggedIn(elsewhere)).toBe(true);
    const old = await login(app, EMAIL, PASSWORD);
    expect(old.lastResponse.statusCode).toBe(303);
  });

  it("counts a wrong current password as a failed login", async () => {
    const { app, here } = await twoSessions();
    for (let i = 0; i < 5; i++) {
      const res = await changePassword(here, { current: "wrong horse" });
      expect(res.statusCode).toBe(400);
    }

    // The same IP is now limited, on the password form and at login.
    const sixth = await changePassword(here);
    expect(sixth.statusCode).toBe(429);
    const atLogin = await login(
      app,
      EMAIL,
      PASSWORD,
      new Browser(app, here.ip),
    );
    expect(atLogin.lastResponse.statusCode).toBe(429);
  });

  it("counts towards the per-email limit too", async () => {
    const { app } = await twoSessions();
    for (let i = 0; i < 10; i++) {
      const browser = await login(
        app,
        EMAIL,
        PASSWORD,
        new Browser(app, `198.51.100.${100 + i}`),
      );
      await changePassword(browser, { current: "wrong horse" });
    }
    const res = await login(
      app,
      EMAIL,
      PASSWORD,
      new Browser(app, "198.51.100.200"),
    );
    expect(res.lastResponse.statusCode).toBe(429);
  });

  it("needs the form's CSRF token", async () => {
    const { here } = await twoSessions();
    const res = await here.submit(
      "/settings",
      "/settings/password",
      {
        current: PASSWORD,
        password: "battery staple",
        confirm: "battery staple",
      },
      { csrf: null },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("Log out everywhere", () => {
  it("ends every session of the User, the current one too", async () => {
    const { here, elsewhere } = await twoSessions();
    expect((await here.get("/settings")).body).toContain(
      'action="/logout-everywhere"',
    );

    const res = await here.submit("/settings", "/logout-everywhere");
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
    expect(await loggedIn(here)).toBe(false);
    expect(await loggedIn(elsewhere)).toBe(false);
  });

  it("needs the form's CSRF token", async () => {
    const { here } = await twoSessions();
    const res = await here.submit(
      "/settings",
      "/logout-everywhere",
      {},
      {
        csrf: null,
      },
    );
    expect(res.statusCode).toBe(403);
    expect(await loggedIn(here)).toBe(true);
  });

  it("leaves other Users' sessions alone", async () => {
    const ctx = await twoSessions();
    await createUser(ctx.db, { email: "you@example.com", password: PASSWORD });
    const other = await login(ctx.app, "you@example.com", PASSWORD);

    await ctx.here.submit("/settings", "/logout-everywhere");
    expect(await loggedIn(other)).toBe(true);
  });
});
