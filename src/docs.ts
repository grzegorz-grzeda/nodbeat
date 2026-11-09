import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { BuildInfo } from "./build-info.js";
import { assetCacheControl } from "./layout.js";
import { html } from "./html.js";

interface StaticFile {
  body: Buffer;
  type: string;
}

const IMAGE_TYPES: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** `url("data:…")` and `url(data:…)` in a stylesheet; group 1 is the quoted form, 2 the bare one. */
const DATA_URL = /url\(\s*(?:"data:((?:[^"\\]|\\.)*)"|data:([^)"]*))\s*\)/g;

/** Decodes the part of a data URL after `data:`, e.g. `image/png;base64,iVBOR…`. */
function decodeDataUrl(rest: string): StaticFile | undefined {
  const comma = rest.indexOf(",");
  const [mime = "", ...params] = rest.slice(0, comma).split(";");
  if (!IMAGE_TYPES[mime]) return undefined;
  const data = rest.slice(comma + 1);
  const body = params.includes("base64")
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data));
  return { body, type: mime };
}

/**
 * Swagger UI's stylesheet inlines its icons as `data:` URLs, which `default-src 'self'`
 * blocks. Each one becomes its own file under `/docs/img/`, and the stylesheet points there.
 */
function extractImages(css: string, files: Map<string, StaticFile>): string {
  return css.replace(
    DATA_URL,
    (match, quoted: string | undefined, bare: string | undefined) => {
      const rest = quoted?.replace(/\\(.)/g, "$1") ?? bare ?? "";
      const image = decodeDataUrl(rest);
      if (!image) return match;
      const hash = createHash("sha256").update(image.body).digest("hex");
      const name = `img-${hash.slice(0, 16)}.${IMAGE_TYPES[image.type]}`;
      files.set(name, image);
      return `url("${name}")`;
    },
  );
}

/**
 * The only Swagger UI files the page loads, read once at startup from the installed
 * `swagger-ui-dist`; anything else in the package stays unserved.
 */
function loadSwaggerUi(): Map<string, StaticFile> {
  const require = createRequire(import.meta.url);
  const dir = dirname(require.resolve("swagger-ui-dist/package.json"));
  const read = (name: string) => readFileSync(join(dir, name));
  const files = new Map<string, StaticFile>();
  files.set("swagger-ui-bundle.js", {
    body: read("swagger-ui-bundle.js"),
    type: "text/javascript; charset=utf-8",
  });
  // Its source map isn't served, so drop the comment pointing to it.
  const css = extractImages(
    read("swagger-ui.css").toString("utf8"),
    files,
  ).replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, "");
  files.set("swagger-ui.css", {
    body: Buffer.from(css),
    type: "text/css; charset=utf-8",
  });
  return files;
}

/**
 * Public API docs: `/docs` is a plain Swagger UI page (no app shell, light theme only)
 * reading `/openapi.yaml`. Every file it loads is served by nodbeat, and it has no
 * inline code, so it passes the strict CSP the layout adds to HTML responses.
 */
export function registerDocs(
  app: FastifyInstance,
  deps: { build: BuildInfo },
): void {
  const files = loadSwaggerUi();
  const cacheControl = assetCacheControl(deps.build);
  const v = `?v=${encodeURIComponent(deps.build.commit)}`;
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>API docs · nodbeat</title>
        <link rel="icon" href="/assets/favicon.svg${v}" type="image/svg+xml" />
        <link rel="stylesheet" href="/docs/swagger-ui.css${v}" />
        <link rel="stylesheet" href="/assets/docs.css${v}" />
        <script src="/docs/swagger-ui-bundle.js${v}" defer></script>
        <script src="/assets/docs.js${v}" defer></script>
      </head>
      <body>
        <a href="/" class="docs-back">← nodbeat</a>
        <div id="swagger-ui"></div>
      </body>
    </html>`.value;

  app.get("/docs", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(page),
  );

  app.get<{ Params: { name: string } }>("/docs/:name", async (req, reply) => {
    const file = files.get(req.params.name);
    if (!file) return reply.code(404).type("text/plain").send("Not Found");
    return reply
      .type(file.type)
      .header("cache-control", cacheControl)
      .send(file.body);
  });
}
