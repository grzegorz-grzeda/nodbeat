import { describe, expect, it } from "vitest";
import { loadBuildInfo } from "../src/build-info.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { buildTestApp } from "./helpers.js";

const validEnv = {
  MONGODB_URI: "mongodb://localhost/nodbeat",
  PUBLIC_BASE_URL: "https://nodbeat.test",
  SESSION_SECRET: "x".repeat(32),
  TELEGRAM_BOT_TOKEN: "123:token",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  TRUSTED_PROXY_IP: "172.30.0.10",
};

describe("/.well-known/security.txt", () => {
  it("is served as text/plain with Contact, Expires, languages and Policy", async () => {
    const ctx = await buildTestApp({
      securityContact: "mailto:security@example.com",
    });
    const res = await ctx.app.inject("/.well-known/security.txt");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    const fields = Object.fromEntries(
      res.body
        .trim()
        .split("\n")
        .map((line) => line.split(/: (.*)/s).slice(0, 2)),
    ) as Record<string, string>;
    expect(fields).toEqual({
      Contact: "mailto:security@example.com",
      // The test build has no build time: one year from startup.
      Expires: "2027-01-01T00:00:00Z",
      "Preferred-Languages": "en, pl",
      Policy:
        "https://github.com/grzegorz-grzeda/nodbeat/blob/main/SECURITY.md",
    });
    // RFC 9116: Expires is an RFC 3339 date in the future, less than a year and a day away.
    const expires = new Date(fields.Expires!).getTime();
    const now = ctx.clock.now().getTime();
    expect(expires).toBeGreaterThan(now);
    expect(expires - now).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });

  it("is a 404 without SECURITY_CONTACT", async () => {
    const ctx = await buildTestApp();
    const res = await ctx.app.inject("/.well-known/security.txt");
    expect(res.statusCode).toBe(404);
  });
});

describe("SECURITY_CONTACT", () => {
  it("takes a mailto: address or an https URL", () => {
    expect(
      loadConfig({ ...validEnv, SECURITY_CONTACT: " mailto:s@example.com " })
        .securityContact,
    ).toBe("mailto:s@example.com");
    expect(
      loadConfig({
        ...validEnv,
        SECURITY_CONTACT: "https://example.com/security",
      }).securityContact,
    ).toBe("https://example.com/security");
    expect(loadConfig(validEnv).securityContact).toBeUndefined();
  });

  it.each(["security@example.com", "http://example.com/security", "mailto:"])(
    "rejects %s",
    (value) => {
      expect(() =>
        loadConfig({ ...validEnv, SECURITY_CONTACT: value }),
      ).toThrow(ConfigError);
    },
  );
});

describe("APP_BUILT_AT", () => {
  it("is the build time; missing or unparseable: none", () => {
    expect(
      loadBuildInfo({
        APP_VERSION: "1.0.0",
        APP_BUILT_AT: "2026-11-23T10:00:00Z",
      }).builtAt,
    ).toEqual(new Date("2026-11-23T10:00:00Z"));
    expect(loadBuildInfo({ APP_VERSION: "1.0.0" }).builtAt).toBeUndefined();
    expect(
      loadBuildInfo({ APP_VERSION: "1.0.0", APP_BUILT_AT: "soon" }).builtAt,
    ).toBeUndefined();
  });
});
