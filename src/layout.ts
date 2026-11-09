import { readdirSync, readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Auth } from "./auth.js";
import type { BuildInfo } from "./build-info.js";
import { takeFlash } from "./flash.js";
import { csrfField, html, type SafeHtml } from "./html.js";
import { STATE_LABELS, type MonitorState } from "./monitor-state.js";
import { DEFAULT_THEME, THEMES, themeOf, type Theme } from "./users.js";

const REPO_URL = "https://github.com/grzegorz-grzeda/nodbeat";
const CSP = "default-src 'self'";
/** Asset URLs carry `?v=<commit>`, so a new release busts the cache. */
const LONG_CACHE = "public, max-age=31536000, immutable";
/** Local dev always has commit `dev`, so the URL never changes: revalidate instead. */
const DEV_CACHE = "no-cache";

/** Cache-Control for files whose URLs carry `?v=<commit>`. */
export function assetCacheControl(build: BuildInfo): string {
  return build.commit === "dev" ? DEV_CACHE : LONG_CACHE;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface PageOptions {
  title: string;
  body: SafeHtml;
  /** Client scripts from `/assets/`, e.g. `dashboard.js`. */
  scripts?: string[];
}

declare module "fastify" {
  interface FastifyReply {
    /** Sends an HTML page in the app shell: nav for a logged-in User, footer with the running version. */
    page(options: PageOptions): FastifyReply;
  }
}

/** `assets/` sits one level above both `src/` and `dist/`; read once at startup. */
function loadAssets(): Map<string, { body: Buffer; type: string }> {
  const dir = new URL("../assets/", import.meta.url);
  const assets = new Map<string, { body: Buffer; type: string }>();
  for (const name of readdirSync(dir)) {
    const type = CONTENT_TYPES[name.slice(name.lastIndexOf("."))];
    if (type) {
      assets.set(name, { body: readFileSync(new URL(name, dir)), type });
    }
  }
  return assets;
}

/** The ECG-line logo; the same shape as `assets/favicon.svg`. */
const LOGO = html`<svg
  class="logo"
  viewBox="0 0 32 32"
  width="28"
  height="28"
  aria-hidden="true"
>
  <path
    d="M2 17h7l3-7 4 14 4-11 2 4h8"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`;

/** A Monitor's state as a colored badge; `assets/dashboard.js` builds the same markup. */
export function stateBadge(state: MonitorState): SafeHtml {
  return html`<span class="badge badge-${state}">${STATE_LABELS[state]}</span>`;
}

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** Posts to `/settings/theme` and comes back to `back`; `assets/theme.js` saves it without a reload. */
function themeSwitch(theme: Theme, csrf: string, back: string): SafeHtml {
  return html`<form
    method="post"
    action="/settings/theme"
    class="theme-switch"
    aria-label="Theme"
  >
    ${csrfField(csrf)}
    <input type="hidden" name="back" value="${back}" />
    ${THEMES.map(
      (t) =>
        html`<button
          type="submit"
          name="theme"
          value="${t}"
          aria-pressed="${String(t === theme)}"
        >
          ${THEME_LABELS[t]}
        </button>`,
    )}
  </form>`;
}

interface NavUser {
  email: string;
  csrf: string;
  theme: Theme;
  /** Where the theme switch returns to. */
  back: string;
  /** Shows the Admin link. */
  isAdmin: boolean;
}

function nav({ email, csrf, theme, back, isAdmin }: NavUser): SafeHtml {
  return html`<input type="checkbox" id="nav-toggle" class="nav-toggle" />
    <label for="nav-toggle" class="nav-toggle-label">Menu</label>
    <nav class="nav-links" aria-label="Main">
      <a href="/">Dashboard</a>
      <a href="/monitors/new">New Monitor</a>
      <a href="/settings">Settings</a>
      ${isAdmin && html`<a href="/admin">Admin</a>`}
      ${themeSwitch(theme, csrf, back)}
      <span class="nav-email">${email}</span>
      <form method="post" action="/logout">
        ${csrfField(csrf)}
        <button type="submit" class="button-link">Log out</button>
      </form>
    </nav>`;
}

export function renderPage(
  options: PageOptions & {
    build: BuildInfo;
    user?: NavUser | undefined;
    /** One-time message from the previous action, shown above the body. */
    flash?: string | undefined;
  },
): string {
  const { build, user } = options;
  const scripts = [...(options.scripts ?? []), ...(user ? ["theme.js"] : [])];
  const asset = (name: string) =>
    `/assets/${name}?v=${encodeURIComponent(build.commit)}`;
  const shortCommit = build.commit.slice(0, 7);
  return html`<!doctype html>
    <html lang="en" data-theme="${user?.theme ?? DEFAULT_THEME}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${options.title} · nodbeat</title>
        <link rel="icon" href="${asset("favicon.svg")}" type="image/svg+xml" />
        <link rel="stylesheet" href="${asset("app.css")}" />
        ${scripts.map((s) => html`<script src="${asset(s)}" defer></script>`)}
      </head>
      <body>
        <header class="site-header">
          <a href="/" class="brand">${LOGO}<span>nodbeat</span></a>
          ${user ? nav(user) : ""}
        </header>
        <main>
          ${
            options.flash
              ? html`<p class="flash" role="status">${options.flash}</p>`
              : ""
          }
          ${options.body}
        </main>
        <footer class="site-footer">
          <a href="${REPO_URL}/releases/tag/v${build.version}"
            >v${build.version} · ${shortCommit}</a
          >
          · <a href="/docs">API docs</a>
        </footer>
      </body>
    </html> `.value;
}

/** Serves `/assets/*`, adds `reply.page()` and the CSP header on every HTML response. */
export function registerLayout(
  app: FastifyInstance,
  deps: { auth: Auth; build: BuildInfo },
): void {
  const { auth, build } = deps;
  const assets = loadAssets();
  const cacheControl = assetCacheControl(build);

  app.get<{ Params: { name: string } }>("/assets/:name", async (req, reply) => {
    const asset = assets.get(req.params.name);
    if (!asset) return reply.errorPage(404);
    return reply
      .type(asset.type)
      .header("cache-control", cacheControl)
      .send(asset.body);
  });

  app.decorateReply("page", function (this: FastifyReply, options) {
    const req = this.request;
    const user = req.user
      ? {
          email: req.user.email,
          csrf: auth.csrfToken(req, this),
          theme: themeOf(req.user),
          // A page rendered for a POST (e.g. a form error) has no URL to come back to.
          back: req.method === "GET" ? req.url : "/",
          isAdmin: req.user.isAdmin,
        }
      : undefined;
    return this.type("text/html; charset=utf-8").send(
      renderPage({ ...options, build, user, flash: takeFlash(req, this) }),
    );
  });

  app.addHook("onSend", async (_req, reply, payload) => {
    const type = reply.getHeader("content-type");
    if (typeof type === "string" && type.startsWith("text/html")) {
      reply.header("content-security-policy", CSP);
    }
    return payload;
  });
}
