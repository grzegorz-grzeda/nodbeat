import { isIP } from "node:net";

export interface Config {
  mongoUri: string;
  publicBaseUrl: string;
  sessionSecret: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  /** External URL nodbeat sends its own Heartbeat to; disabled when unset. */
  selfHeartbeatUrl: string | undefined;
  /** The edge Caddy's fixed address; only its X-Forwarded-For is believed. */
  trustedProxyIp: string;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

const MIN_SESSION_SECRET_LENGTH = 32;

/** Reads and checks configuration from environment variables. Throws ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} is required`);
      return "";
    }
    return value;
  };

  const checkHttpUrl = (name: string, value: string): void => {
    if (!value) return;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        problems.push(`${name} must be an http(s) URL`);
      }
    } catch {
      problems.push(`${name} must be a valid URL`);
    }
  };

  const mongoUri = required("MONGODB_URI");
  if (mongoUri && !hasDatabaseName(mongoUri)) {
    problems.push(
      "MONGODB_URI must name a database in its path (e.g. .../nodbeat)",
    );
  }
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/+$/, "");
  checkHttpUrl("PUBLIC_BASE_URL", publicBaseUrl);
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`,
    );
  }
  const telegramBotToken = required("TELEGRAM_BOT_TOKEN");
  const telegramWebhookSecret = required("TELEGRAM_WEBHOOK_SECRET");
  if (
    telegramWebhookSecret &&
    !/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)
  ) {
    problems.push(
      "TELEGRAM_WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ and -",
    );
  }

  const selfHeartbeatUrl = env.SELF_HEARTBEAT_URL?.trim() || undefined;
  if (selfHeartbeatUrl) checkHttpUrl("SELF_HEARTBEAT_URL", selfHeartbeatUrl);

  const trustedProxyIp = required("TRUSTED_PROXY_IP");
  if (trustedProxyIp && isIP(trustedProxyIp) === 0) {
    problems.push("TRUSTED_PROXY_IP must be an IPv4 or IPv6 address");
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    mongoUri,
    publicBaseUrl,
    sessionSecret,
    telegramBotToken,
    telegramWebhookSecret,
    selfHeartbeatUrl,
    trustedProxyIp,
  };
}

/** The driver silently falls back to the "test" database when the URI has no path. */
function hasDatabaseName(mongoUri: string): boolean {
  const afterScheme = mongoUri.replace(/^mongodb(\+srv)?:\/\//, "");
  const path = afterScheme.split("?")[0]?.split("/")[1];
  return Boolean(path);
}
