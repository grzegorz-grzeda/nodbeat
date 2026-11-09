import { readFileSync } from "node:fs";

/** What is running: the release version and the commit it was built from. */
export interface BuildInfo {
  version: string;
  commit: string;
}

/**
 * Reads `APP_VERSION` / `APP_COMMIT`, baked into the image as build args.
 * Local dev falls back to the `package.json` version and `dev`.
 */
export function loadBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    version: env.APP_VERSION?.trim() || packageVersion(),
    commit: env.APP_COMMIT?.trim() || "dev",
  };
}

/** `package.json` sits one level above both `src/` and `dist/`. */
function packageVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}
