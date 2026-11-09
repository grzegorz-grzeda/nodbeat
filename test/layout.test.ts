import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, login, testBuild } from "./helpers.js";

const LONG_CACHE = "public, max-age=31536000, immutable";

describe("static assets", () => {
  it.each([
    ["/assets/app.css", "text/css"],
    ["/assets/dashboard.js", "text/javascript"],
    ["/assets/theme.js", "text/javascript"],
    ["/assets/favicon.svg", "image/svg+xml"],
  ])("serves %s as %s with a long cache", async (url, type) => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: `${url}?v=abc1234` });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain(type);
    expect(res.headers["cache-control"]).toBe(LONG_CACHE);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("answers 404 for an unknown asset", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/assets/nope.css" });

    expect(res.statusCode).toBe(404);
  });
});

/** Inline `<script>` (without src), `<style>`, `style="…"` and `on…="…"` handlers: all blocked by the CSP. */
function inlineCode(body: string): string[] {
  return [
    ...body.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g),
    ...body.matchAll(/<style[\s>]/g),
    ...body.matchAll(/\sstyle="/g),
    ...body.matchAll(/\son[a-z]+="/g),
  ].map((m) => m[0]);
}

async function loggedInWithMonitor() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email: "me@example.com", password: "pw-123456" });
  const browser = await login(ctx.app, "me@example.com", "pw-123456");
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Garden sensor",
    interval: "60",
    intervalUnit: "s",
    grace: "30",
    graceUnit: "s",
  });
  const monitor = res.headers.location as string;
  return { ...ctx, browser, monitor };
}

describe("HTML pages", () => {
  it("send a strict CSP and contain no inline scripts or styles", async () => {
    const { browser, monitor } = await loggedInWithMonitor();
    const pages = [
      "/",
      "/monitors/new",
      monitor,
      `${monitor}/edit`,
      `${monitor}/delete`,
      "/settings",
      "/monitors/000000000000000000000000",
    ];

    for (const url of pages) {
      const res = await browser.get(url);
      expect(res.headers["content-type"], url).toContain("text/html");
      expect(res.headers["content-security-policy"], url).toBe(
        "default-src 'self'",
      );
      expect(inlineCode(res.body), url).toEqual([]);
    }
  });

  it("CSP and no inline code on the login page too", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/login" });

    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(inlineCode(res.body)).toEqual([]);
  });

  it("link the stylesheet and favicon with the commit for cache busting", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/login" });

    expect(res.body).toContain('href="/assets/app.css?v=abc1234"');
    expect(res.body).toContain('href="/assets/favicon.svg?v=abc1234"');
  });

  it("load the Dashboard poll script from an asset", async () => {
    const { browser } = await loggedInWithMonitor();

    const res = await browser.get("/");

    expect(res.body).toContain('src="/assets/dashboard.js?v=abc1234"');
  });

  it("show the running version in the footer, linking to its GitHub release", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/login" });

    expect(res.body).toContain(
      `href="https://github.com/grzegorz-grzeda/nodbeat/releases/tag/v${testBuild.version}"`,
    );
    expect(res.body).toContain("v1.2.3 · abc1234");
  });

  it("link to the API docs in the footer, logged in or not", async () => {
    const { app, browser, monitor } = await loggedInWithMonitor();
    const footer = (body: string) =>
      /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(body)?.[0];

    const anonymous = await app.inject({ method: "GET", url: "/login" });
    const loggedIn = await browser.get(monitor);

    for (const res of [anonymous, loggedIn]) {
      expect(footer(res.body)).toMatch(
        /<a [^>]*href="\/docs"[^>]*>API docs<\/a>/,
      );
    }
  });

  it("show the nav with the User's email only when logged in", async () => {
    const { app, browser } = await loggedInWithMonitor();

    const loggedIn = (await browser.get("/")).body;
    const anonymous = (await app.inject({ method: "GET", url: "/login" })).body;

    for (const link of ['href="/monitors/new"', 'href="/settings"']) {
      expect(loggedIn).toContain(link);
      expect(anonymous).not.toContain(link);
    }
    expect(loggedIn).toContain("me@example.com");
    expect(loggedIn).toContain('action="/logout"');
    expect(anonymous).not.toContain('action="/logout"');
  });
});
