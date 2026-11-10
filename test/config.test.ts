import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const validEnv = {
  MONGODB_URI: "mongodb://localhost/nodbeat",
  PUBLIC_BASE_URL: "https://nodbeat.test",
  SESSION_SECRET: "x".repeat(32),
  TELEGRAM_BOT_TOKEN: "123:token",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  TRUSTED_PROXY_IP: "172.30.0.10",
};

const problemsOf = (env: NodeJS.ProcessEnv): string => {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
  throw new Error("expected a ConfigError");
};

describe("loadConfig: TRUSTED_PROXY_IP", () => {
  it("reads an IPv4 or IPv6 address", () => {
    expect(loadConfig(validEnv).trustedProxyIp).toBe("172.30.0.10");
    expect(
      loadConfig({ ...validEnv, TRUSTED_PROXY_IP: " fd00::10 " })
        .trustedProxyIp,
    ).toBe("fd00::10");
  });

  it("is required", () => {
    expect(problemsOf({ ...validEnv, TRUSTED_PROXY_IP: "" })).toContain(
      "TRUSTED_PROXY_IP is required",
    );
  });

  it.each(["caddy", "172.30.0.0/24", "300.1.1.1", "172.30.0.10:80"])(
    "rejects %s",
    (value) => {
      expect(problemsOf({ ...validEnv, TRUSTED_PROXY_IP: value })).toContain(
        "TRUSTED_PROXY_IP must be an IPv4 or IPv6 address",
      );
    },
  );
});
