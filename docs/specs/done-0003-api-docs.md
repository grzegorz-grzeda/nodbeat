# Spec 0003: API docs

Status: ready-for-agent

## Problem Statement

The only way to learn how to send a Heartbeat is the handful of curl and cron examples on the Monitor page. Someone wiring up an IoT device, a script in another language or a monitoring tool has to guess the rest: whether POST works, which body formats carry a message, how long a message may be, what the status codes mean and how often Heartbeats may be sent. Nothing describes `/health` either. There's no machine-readable description to import into Postman or a code generator.

## Solution

nodbeat serves public API docs at `/docs`: a Swagger UI page that describes the Heartbeat URL and `/health` and lets the reader try a request. The same OpenAPI document is served raw at `/openapi.yaml`. The Monitor page and the footer link to the docs. Links never carry a Monitor's token, because the Heartbeat URL is secret.

## User Stories

1. As a User, I want an "API docs" link next to my Monitor's Heartbeat URL and curl examples, so that I can find the full reference when the examples aren't enough.
2. As a User, I want an "API docs" link in the footer of every page, so that I can find the docs from anywhere.
3. As a User, I want the docs to be open without logging in, so that I can read them on the machine I'm setting up a device on.
4. As a User, I want the docs to show that a Heartbeat can be sent with GET or POST, so that I can use whatever my device supports.
5. As a User, I want the docs to list every way of attaching a message (`?msg=`, a plain-text body, a body with no Content-Type, a JSON `msg` field, a form `msg` field), so that I can pick the one my device can send.
6. As a User, I want the docs to say the query message wins over a body message, so that I'm not surprised when both are sent.
7. As a User, I want the docs to say messages are cut to 200 characters, so that I keep the important part first.
8. As a User, I want the docs to say a broken JSON body is kept as plain text and still counts as a Heartbeat, so that I know a malformed payload doesn't cost me a Heartbeat.
9. As a User, I want the docs to explain 200, 404, 429 and 413 for the Heartbeat URL, so that my device can react correctly (e.g. stop retrying on 404 after I regenerate the Heartbeat URL).
10. As a User, I want the docs to state the limit of one Heartbeat per second per Monitor, so that I don't design a device that gets rejected.
11. As a User, I want the docs to state the 8 KiB body limit, so that I don't send large payloads.
12. As a User, I want "Try it out" on the docs page, so that I can paste my Heartbeat URL's token and send a test Heartbeat from the browser.
13. As a User, I want the docs to use a placeholder token, so that no real Heartbeat URL is ever shown or leaked.
14. As a User, I want the docs to target this instance's public URL, so that "Try it out" and copied examples hit the right server.
15. As a User, I want a "← nodbeat" link on the docs page, so that I can get back to the app.
16. As the Admin, I want the docs to describe `/health` with its `{status, version, commit}` response for 200 and 503, so that I can point external checks at it.
17. As the Admin, I want the OpenAPI document's version to be the running version, so that the docs always match what's deployed.
18. As a developer integrating nodbeat, I want the raw OpenAPI document at `/openapi.yaml`, so that I can import it into Postman or generate a client.
19. As the Admin, I want the docs page to load no third-party scripts and to obey the strict CSP, so that adding docs doesn't weaken the app's security.
20. As a User, I want the docs to use the same words as the app (Monitor, Heartbeat, Heartbeat URL), so that the docs and the UI read as one product.

## Implementation Decisions

- **Scope**: the docs describe the Heartbeat URL (`GET|POST /hb/{token}`) and `/health` only. The session-only `/dashboard.json`, the login, Settings and Monitor forms, and the Telegram webhook are internal and not documented.
- **Source**: a hand-written OpenAPI 3 YAML document kept in the repo, not generated from Fastify route schemas. Two operations don't justify route schemas, and the Heartbeat URL's several body formats are awkward to express as one. The served document is the file with `info.version` set to the running build's version (from the build info added in issue 0010) and `servers` set to `PUBLIC_BASE_URL`.
- **Routes**: `GET /docs` serves the Swagger UI page; `GET /openapi.yaml` serves the document (`application/yaml`). Both are public. Swagger UI's assets are served by nodbeat itself (via `@fastify/swagger-ui` or vendored `swagger-ui-dist`), never from a CDN.
- **CSP**: the docs page has no inline `<script>` or `<style>`, so it passes the `Content-Security-Policy: default-src 'self'` from issue 0011. If the chosen package can only boot Swagger UI with an inline script, the initializer is served as a static asset instead.
- **Page**: a plain Swagger UI page, not wrapped in the app's nav and footer, with a "← nodbeat" link at the top. Light theme only; the User's theme preference (issue 0012) doesn't apply.
- **Try it out**: enabled. The `token` path parameter has a placeholder example, which gets a 404.
- **Heartbeat URL contract** as documented:
  - Methods: GET and POST.
  - Message sources, by priority: `msg` query parameter, then the body. The body can be `text/plain`, any or no Content-Type (taken as text), `application/json` with a `msg` string, or `application/x-www-form-urlencoded` with `msg`. Broken JSON is taken as plain text.
  - The message is trimmed and cut to 200 characters; an empty message means none.
  - Responses (all `text/plain`): `200 OK` (Heartbeat recorded), `404 Not Found` (unknown token, e.g. after the Heartbeat URL was regenerated or the Monitor deleted), `429 Too Many Requests` (more than one Heartbeat per second per Monitor), `413` (body over 8 KiB).
- **`/health` contract** as documented: `200 {"status":"ok","version","commit"}`, `503 {"status":"mongo unavailable","version","commit"}`.
- **Links**: the Monitor page gets an "API docs" link next to the curl examples; the footer (issue 0011) gets an "API docs" link. Links point to plain `/docs`; a token is never put in a URL.
- **Wording**: the docs say Heartbeat, Heartbeat URL and Monitor, never "endpoint", "ping" or "check" (all on the glossary's _Avoid_ lists). The UI label is "API docs"; it's not a glossary term.
- No glossary changes and no ADR: the decision is small and easy to reverse.

## Testing Decisions

- Test only external behaviour through the HTTP seam: `buildTestApp()` and `app.inject`, plus the cookie-keeping `Browser` helper for logged-in pages. No new seam.
- Prior art: the `/health` tests (status and body shape through `inject`) and the Monitor page tests (logged-in page content through `Browser`).
- `GET /docs`: 200, HTML, the CSP header present, no inline `<script>` or `<style>`, and every asset it references answers 200.
- `GET /openapi.yaml`: 200, parses as YAML, has the `/hb/{token}` (GET and POST) and `/health` operations, `info.version` equals the build version, `servers` uses `PUBLIC_BASE_URL`.
- Monitor page: links to `/docs`, and the link contains no token.
- The document's prose is reviewed by hand against the Heartbeat URL's behaviour, not asserted test by test. The existing Heartbeat intake tests already pin that behaviour.

## Out of Scope

- A REST API for managing Monitors, Incidents or Linked chats, and API keys or tokens for it.
- Documenting `/dashboard.json`, the HTML forms or the Telegram webhook.
- Dark theme or the app's nav and footer on the docs page.
- Pre-filling a Monitor's token into the docs.
- Generating the OpenAPI document from route schemas, or checking it against the routes automatically.
- Client SDKs.

## Further Notes

- Depends on issue 0010 (build version, done) and issue 0011 (CSP and footer). Implement after 0011.
- Vocabulary: `GLOSSARY.md`. Related: spec 0002.
