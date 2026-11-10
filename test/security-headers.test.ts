import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, CSP, login } from "./helpers.js";

const EXPECTED = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy": CSP,
};

function expectSecurityHeaders(
  headers: Record<string, unknown>,
  url: string,
): void {
  for (const [name, value] of Object.entries(EXPECTED)) {
    expect(headers[name], `${url} ${name}`).toBe(value);
  }
}

describe("security headers", () => {
  it("are on every kind of response: HTML, JSON, Heartbeat, health, asset, docs, 404", async () => {
    const { app, db } = await buildTestApp();
    await createUser(db, { email: "me@example.com", password: "pw-123456" });
    const browser = await login(app, "me@example.com", "pw-123456");
    const created = await browser.submit("/monitors/new", "/monitors", {
      name: "Garden sensor",
      interval: "60",
      intervalUnit: "s",
      grace: "30",
      graceUnit: "s",
    });
    const monitor = created.headers.location as string;
    const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(
      (await browser.get(monitor)).body,
    )?.[1];
    expect(hb).toBeDefined();

    const urls = [
      "/",
      monitor,
      "/dashboard.json",
      hb!,
      "/health",
      "/assets/app.css",
      "/docs",
      "/docs/swagger-ui-bundle.js",
      "/openapi.yaml",
      "/no-such-page",
    ];
    for (const url of urls) {
      const res = await browser.get(url);
      expect(res.statusCode, url).toBeLessThan(500);
      expectSecurityHeaders(res.headers, url);
    }
  });

  it("are on the login page for an anonymous visitor", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/login" });

    expectSecurityHeaders(res.headers, "/login");
  });
});
