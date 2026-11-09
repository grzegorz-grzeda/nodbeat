# Spec 0002: UI refresh and delivery

Status: ready-for-agent

## Problem Statement

nodbeat works, but it looks like a bare HTML form. The Dashboard is a plain table, actions give no feedback, Heartbeat URLs are awkward to copy, and the pages are cramped on a phone. There is no dark mode. A visitor who isn't logged in is sent straight to a login form with no idea what nodbeat is. Deploying is manual: I SSH into the VPS, `git pull` and rebuild there. Nothing in the app tells me which version is running.

## Solution

Keep server-rendered HTML, but give it a real design system: one static, token-based stylesheet, a nav bar, a footer, state-colored badges, flash messages, copy buttons, confirmations, empty states and a mobile layout. Each User picks a light, dark or system theme in the nav. Logged-out visitors at `/` get a landing page. Pushing a SemVer tag `vX.Y.Z` builds an image in GitHub Actions, pushes it to GHCR and deploys it to the VPS over SSH. The footer and `/health` show the running version and commit.

## User Stories

### Look and feel

1. As a User, I want a consistent, modern look (system fonts, one accent color, state colors for Up/Down/New/Paused), so that nodbeat feels like a finished product.
2. As a User, I want a nav bar on every logged-in page (Dashboard, New Monitor, Settings, my email, Log out), so that I can move around without the back button.
3. As a User, I want the pages to work well on a phone, so that I can check my Monitors on the go.
4. As a User, I want readable contrast (WCAG AA) and a visible keyboard focus in both themes, so that the UI is accessible.
5. As a User, I want an ECG-line logo and favicon, so that the nodbeat tab is easy to find.

### Themes

6. As a User, I want to choose a light, dark or system theme with a 3-way switch in the nav, so that the UI matches my preference.
7. As a User, I want my theme stored on my account, so that it follows me across browsers and devices.
8. As a User, I want the page to render in my theme from the first paint, so that there's no flash of the wrong theme.
9. As a visitor who isn't logged in, I want the landing and login pages to follow my OS theme, so that they don't blind me at night.

### Dashboard and pages

10. As a User, I want the Dashboard to show each Monitor with a state badge, a relative "last Heartbeat 2 min ago" (exact time on hover), its last message and 7-day Uptime, so that I see what matters at a glance.
11. As a User, I want an empty state with a "Create your first Monitor" button when I have no Monitors, so that I know what to do next.
12. As a User, I want a flash message after saving, pausing, unpausing, regenerating or deleting, so that I know the action worked.
13. As a User, I want a copy button for the Heartbeat URL and ready-to-paste `curl` examples, so that wiring a device is quick.
14. As a User, I want a confirmation before deleting a Monitor, regenerating its Heartbeat URL or unlinking a chat, so that I don't destroy things by accident.

### Landing page

15. As a visitor who isn't logged in, I want `/` to explain what nodbeat is (tagline, a 3-step how-it-works and a feature list), so that I understand it before logging in.
16. As a visitor, I want a single "Log in" button, so that I'm not offered a sign-up that doesn't exist.
17. As a User who is logged in, I want `/` to keep showing my Dashboard, so that my bookmark still works.

### Versions and delivery

18. As the Admin, I want the footer of every page to show `vX.Y.Z · <short commit>` linking to the GitHub release, so that I know what's running.
19. As the Admin, I want `/health` to return JSON with status, version and commit, so that the deploy can check that the new version is live.
20. As the Admin, I want a push of a SemVer tag `vX.Y.Z` to test, build, publish and deploy nodbeat, so that releasing is one command.
21. As the Admin, I want the deploy to refuse a tag that doesn't match `package.json`, so that the displayed version is always true.
22. As the Admin, I want the deploy job to fail if `/health` doesn't report the new version within 90 s, so that a broken deploy is noticed.
23. As the Admin, I want to redeploy an earlier version from the Actions tab without rebuilding, so that I can roll back quickly.
24. As the Admin, I want a `CHANGELOG.md` and a GitHub Release created from its section for each tag, so that I can see what changed.
25. As the Admin, I want typecheck, tests and lint to run on every push to `main`, so that a broken commit shows up before I tag it.

## Implementation Decisions

- **Rendering**: stays server-rendered with the `html` tagged template. No frontend framework, no CSS build step.
- **Assets**: CSS and client scripts move to static files under `/assets/` (via `@fastify/static` or a small handler), referenced with `?v=<commit>` for cache busting. The Dashboard poll script moves out of `dashboard.ts` into an asset.
- **CSP**: every HTML response sends `Content-Security-Policy: default-src 'self'` (plus `img-src 'self' data:` if the inline-SVG favicon needs it). No inline scripts or styles remain.
- **Design tokens**: CSS custom properties on `:root`, overridden for dark under `[data-theme="dark"]` and under `@media (prefers-color-scheme: dark)` for `[data-theme="system"]`.
- **Theme**: a `theme` field on the User, `"light" | "dark" | "system"`, default `"system"` (missing field = system, so no migration). Server renders `<html data-theme="...">`. The nav switch is a form POST to `/settings/theme` (works without JS, redirects back); JS enhances it to save without a reload. Logged-out pages render `data-theme="system"`.
- **Flash messages**: a short-lived signed cookie set before a redirect and cleared once it's shown.
- **Landing**: `GET /` renders the landing page when there's no session and the Dashboard otherwise. `/login` is unchanged.
- **Version**: `APP_VERSION` and `APP_COMMIT` are baked into the image as build args / env vars. Local dev falls back to `package.json` version and `dev`.
- **`/health`**: `200 {"status":"ok","version","commit"}`, `503 {"status":"mongo unavailable","version","commit"}`.
- **Release pipeline** (ADR 0005): GitHub Actions on `v*.*.*` tag: check tag = `package.json` version → typecheck/test/lint → build → push `ghcr.io/grzegorz-grzeda/nodbeat:<X.Y.Z>` (public) → SSH to the VPS: `cd ~/nodbeat && git fetch --tags && git checkout vX.Y.Z && NODBEAT_VERSION=X.Y.Z docker compose pull && docker compose up -d` → poll `https://nodbeat.g2labs.pl/health` until it reports the version (90 s) → create a GitHub Release from the `CHANGELOG.md` section. A `workflow_dispatch` with a `version` input skips the build and only deploys.
- **Compose**: `image: ghcr.io/grzegorz-grzeda/nodbeat:${NODBEAT_VERSION:?}` instead of `build: .`.
- **Secrets** (set by hand): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (a dedicated ed25519 key), `VPS_KNOWN_HOSTS`.
- **Releases**: Keep a Changelog format. Minor bump for features, patch for fixes; stays `0.x`. The current `main` is tagged `v0.9.0` by hand; this spec ships as `v0.10.0`.

## Testing Decisions

- Theme: the switch saves the theme, `data-theme` reflects it, unknown values are rejected, CSRF is required, logged-out pages render `system`.
- Landing: `/` without a session renders the landing page (200, has "Log in"), with a session renders the Dashboard.
- `/health` returns version and commit; 503 shape when Mongo is down.
- CSP header present on HTML responses; no inline `<script>`/`<style>` in rendered pages.
- Flash message shown once after an action, gone on the next page load.
- The pipeline itself is checked by running it for `v0.10.0`.

## Out of Scope

- Public registration, password reset and sign-up on the landing page.
- A frontend framework, SPA or CSS build tooling.
- Web fonts or any third-party requests from the page.
- Automatic rollback on a failed deploy.
- Staging environment, preview deploys, and deploying on every push to `main`.
- Theme switch on logged-out pages.

## Further Notes

- Decisions: ADR 0005 (tag-triggered deploys via GHCR). Vocabulary: `GLOSSARY.md`.
- Manual setup: create the deploy SSH key and add it to `authorized_keys` on the VPS, add the four secrets in GitHub, make the GHCR package public after the first push.
