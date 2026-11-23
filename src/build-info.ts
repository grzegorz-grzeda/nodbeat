import { readFileSync } from "node:fs";

/** What is running: the release version and the commit it was built from. */
export interface BuildInfo {
  version: string;
  commit: string;
  /** When the image was built (`APP_BUILT_AT`); undefined in local dev. */
  builtAt?: Date;
}

/**
 * Reads `APP_VERSION` / `APP_COMMIT`, baked into the image as build args.
 * Local dev falls back to the `package.json` version and `dev`.
 */
export function loadBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    version: env.APP_VERSION?.trim() || packageVersion(),
    commit: env.APP_COMMIT?.trim() || "dev",
    ...builtAt(env.APP_BUILT_AT),
  };
}

/** An unparseable or missing build time is left out: security.txt then counts from startup. */
function builtAt(raw: string | undefined): { builtAt?: Date } {
  const at = raw?.trim() ? new Date(raw.trim()) : null;
  return at && !Number.isNaN(at.getTime()) ? { builtAt: at } : {};
}

/** `package.json` sits one level above both `src/` and `dist/`. */
function packageVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}
