import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, login } from "./helpers.js";

const renderedTheme = (body: string) =>
  /<html[^>]*data-theme="(\w+)"/.exec(body)?.[1];

async function loggedIn() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email: "me@example.com", password: "pw-123456" });
  const browser = await login(ctx.app, "me@example.com", "pw-123456");
  return { ...ctx, browser };
}

describe("theme preference", () => {
  it("defaults to system for a User who never picked one", async () => {
    const { browser } = await loggedIn();

    expect(renderedTheme((await browser.get("/")).body)).toBe("system");
  });

  it.each(["light", "dark", "system"])(
    "saves %s and renders it on every page",
    async (theme) => {
      const { browser } = await loggedIn();

      const res = await browser.submit("/settings", "/settings/theme", {
        theme,
        back: "/settings",
      });

      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe("/settings");
      expect(renderedTheme((await browser.get("/")).body)).toBe(theme);
      expect(renderedTheme((await browser.get("/monitors/new")).body)).toBe(
        theme,
      );
    },
  );

  it("follows the User to another browser", async () => {
    const { app, browser } = await loggedIn();
    await browser.submit("/", "/settings/theme", { theme: "dark" });

    const other = await login(app, "me@example.com", "pw-123456");

    expect(renderedTheme((await other.get("/")).body)).toBe("dark");
  });

  it("marks the current theme in the nav switch, which posts back to the page", async () => {
    const { browser } = await loggedIn();
    await browser.submit("/", "/settings/theme", { theme: "dark" });

    const body = (await browser.get("/monitors/new")).body;

    expect(body).toContain('action="/settings/theme"');
    expect(body).toContain('name="back" value="/monitors/new"');
    expect(body).toMatch(/value="dark"\s+aria-pressed="true"/);
    expect(body).toMatch(/value="light"\s+aria-pressed="false"/);
    expect(body).toContain('src="/assets/theme.js?v=abc1234"');
  });

  it("answers JSON instead of redirecting when the switch script asks", async () => {
    const { browser } = await loggedIn();

    const res = await browser.submit(
      "/",
      "/settings/theme",
      { theme: "light" },
      { headers: { accept: "application/json" } },
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ theme: "light" });
    expect(renderedTheme((await browser.get("/")).body)).toBe("light");
  });

  it("redirects to the Dashboard when the page to go back to isn't local", async () => {
    const { browser } = await loggedIn();

    for (const back of ["https://evil.example", "//evil.example", ""]) {
      const res = await browser.submit("/", "/settings/theme", {
        theme: "dark",
        back,
      });
      expect(res.headers.location, back).toBe("/");
    }
  });

  it("rejects an unknown theme and keeps the old one", async () => {
    const { browser } = await loggedIn();
    await browser.submit("/", "/settings/theme", { theme: "dark" });

    const res = await browser.submit("/", "/settings/theme", {
      theme: "neon",
    });

    expect(res.statusCode).toBe(400);
    expect(renderedTheme((await browser.get("/")).body)).toBe("dark");
  });

  it("requires a CSRF token", async () => {
    const { browser } = await loggedIn();

    const res = await browser.submit(
      "/",
      "/settings/theme",
      { theme: "dark" },
      { csrf: null },
    );

    expect(res.statusCode).toBe(403);
    expect(renderedTheme((await browser.get("/")).body)).toBe("system");
  });

  it("requires a logged-in User", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({
      method: "POST",
      url: "/settings/theme",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "theme=dark",
    });

    expect(res.statusCode).toBe(403);
  });

  it("renders logged-out pages as system, without the switch", async () => {
    const { app, browser } = await loggedIn();
    await browser.submit("/", "/settings/theme", { theme: "dark" });

    const res = await app.inject({ method: "GET", url: "/login" });

    expect(renderedTheme(res.body)).toBe("system");
    expect(res.body).not.toContain('action="/settings/theme"');
  });
});
