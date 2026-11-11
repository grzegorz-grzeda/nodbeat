# Changelog

All notable changes to nodbeat are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Fail signal: `GET|POST /hb/<token>/fail` (optional message, same rules as a Heartbeat) makes a New or Up Monitor Down at once. Its Down Alert says the Monitor "reported a failure" and includes the message. A Fail signal to a Down or Paused Monitor is only recorded. The next Heartbeat brings the Monitor Up.
- The Heartbeats log has a "Signal" column (✓ / Fail).

### Changed

- The 1-per-second limit on a Heartbeat URL is counted per signal kind, so a Fail signal and a Heartbeat in the same second both get through.

## [0.22.0] - 2026-11-11

### Added

- Alerts are formatted in Telegram HTML: the Monitor name is bold, a Down Alert includes the last Heartbeat message, and every Alert ends with a link to its Monitor page. Names and messages are escaped.
- Up Alerts are delivered silently (`disable_notification`); Down Alerts still notify.
- When Telegram upgrades a group to a supergroup, its Linked chat and pending Alerts move to the new chat id, and an Alert that fails with the migration error is resent to the new id at once.
- A chat that removes the bot (`left` or `kicked`) is unlinked straight away.
- At startup the bot's command menu (`start`, `status`, `unlink`) is set and the webhook receives only `message` and `my_chat_member` updates. The manual `/setcommands` step is gone from `docs/deploy.md`.

## [0.21.0] - 2026-11-11

### Security

- Backups are encrypted with `age` on the VPS before upload (`nodbeat-*.archive.gz.age`); no plaintext archive touches the disk. `scripts/backup.sh` now needs `BACKUP_AGE_RECIPIENT` and refuses to run without it. See `docs/deploy.md` step 8 for the key pair, restoring and deleting old unencrypted backups.
- Bot replies never show an email: in a group linked by several Users, `/status` shows one numbered "Account" section per User.
- In a group, `/status` and `/unlink` answer only its Telegram admins; everyone else (and anyone, when Telegram can't say who is an admin) gets "Only group admins can use this command." `/start` stays open to any member.
- When Telegram answers `403` to an Alert (the bot was blocked or removed from the chat), that Linked chat is unlinked instead of retried.
- The Monitor limit is checked and the Monitor created under a per-User lock, so parallel creates can't go past it.
- A User can generate at most 10 Link codes per hour; more get `429` and "Too many Link codes. Try again later."
- CI fails when `pnpm audit --prod` finds a high or critical vulnerability in a production dependency.

## [0.20.0] - 2026-11-11

### Added

- Settings: change your password (current, new and confirmation); every other session is logged out. **Log out everywhere** ends every session, this one included.

### Security

- Only failed logins count towards the login limit: 5 per 15 min per IP, plus 10 per hour per email (unknown emails too), so one User's password can't be guessed quickly from many IPs. A wrong current password on Settings counts as a failed login. Attempts are counted before the password is checked, so parallel requests can't get past the limit. The 429 message now reads "Try again later".
- An IP that sends more than 30 requests a minute to unknown Heartbeat URLs gets `429` on every Heartbeat URL, before any database lookup, until the minute has passed.

## [0.19.0] - 2026-11-11

### Added

- Invites: the Admin creates a single-use link at `/admin/invites` (optional note, expires after 7 days, shown once with a copy button). Whoever opens it chooses email, password and time zone and is logged in as a regular User. Accepting is atomic, so one link makes one User; the accept page is limited to 10 requests per IP per 15 minutes.
- The Invite list shows each Invite's note, created and expiry times and status (pending, expired, revoked, or used by whom and when); a pending Invite can be revoked after confirming.
- The landing page says nodbeat is invite-only for now.

### Security

- Request logs no longer contain Heartbeat URL tokens or Invite codes: the secret path segment is logged as `<redacted>`.

## [0.18.0] - 2026-11-11

### Added

- The Admin page shows how Monitors are set up: counts and shares by Interval (≤ 1 min, ≤ 5 min, ≤ 1 h, ≤ 1 day, > 1 day) and the share with a custom Grace period, with notes, with Alerts off and Paused. Notes are counted, never shown.
- Heartbeats record the `User-Agent` header (trimmed to 200 characters). The Admin page shows how last-7-day Heartbeats arrive: GET vs POST, with a message, and by client (curl, wget, Python, ESP32/Arduino, browser, other, none). Raw User-Agents and messages are never shown.
- The Admin page lists every User with their Monitors, Linked chats, Heartbeats in the last 7 days and the time of their last Heartbeat, most recent first.
- A "Feedback" link to the GitHub issues page in every page's footer.

## [0.17.0] - 2026-11-11

### Security

- `X-Forwarded-For` is believed only from the edge Caddy at the new required `TRUSTED_PROXY_IP`, so another container on the `edge` network can't fake its IP to dodge the login limit or forge recorded source IPs. Set it before upgrading; see `docs/deploy.md` steps 4–5.
- Every response, HTML or not, now carries `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and the CSP `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` (previously only `default-src 'self'`, on HTML only).

## [0.16.0] - 2026-11-10

### Changed

- Each Monitor keeps only its 100 newest Heartbeats and 100 newest Incidents; older ones are deleted. Incidents the 7-day Uptime still needs are kept until they leave its window. Heartbeats still also expire after 7 days.
- The full Incident and Heartbeat logs are a single page of up to 100 rows (no more Newer/Older paging; `?page=` is ignored).

## [0.15.0] - 2026-11-10

### Added

- Admin page at `/admin` (Admin only; 404 for everyone else) with instance totals: Users, Monitors by state, Linked chats, Heartbeats in the last 7 days and Incidents opened in the last 7 and 30 days. Linked from the nav for the Admin.

## [0.14.0] - 2026-11-10

### Changed

- The Monitor page shows the 20 newest Incidents and Heartbeats (was 100 and 500), with a "See all" link when there are more.

### Added

- Full logs at `/monitors/:id/incidents` and `/monitors/:id/heartbeats`: newest first, 100 rows a page, with Newer/Older links.

## [0.13.0] - 2026-11-09

### Added

- One error page for every 40x/50x answer: unknown URLs, a missing Monitor, asset or docs file, a bad form value, an expired form and unexpected errors all show the same page in the app shell (with the nav when logged in) instead of Fastify's JSON or bare text. A request asking for JSON gets `{ "error": ... }`; Heartbeat URLs keep their plain-text answers.

### Changed

- Deploys are pulled by the VPS instead of pushed over SSH (ADR 0006). Releases are tagged `:X.Y.Z` and `:latest`; `compose.yaml` runs `:latest` and `.env` no longer has `NODBEAT_VERSION`. A daily cron job (`scripts/update.sh`, 03:00) pulls and restarts only when the image changed. Running the Release workflow by hand now points `:latest` at an earlier version (rollback). See "Switching from the SSH deploy" in `docs/deploy.md`.
- Container logs are capped at 3 × 10 MB.

## [0.12.0] - 2026-11-09

### Added

- `GET /openapi.yaml`: a public OpenAPI 3 document for the Heartbeat URL and `/health`, stamped with the running version and `PUBLIC_BASE_URL`.
- `GET /docs`: public API docs in Swagger UI, with "Try it out" against `PUBLIC_BASE_URL`. Swagger UI is served by nodbeat itself (no CDN) and runs under the strict CSP.
- "API docs" links to `/docs` on the Monitor page (next to the curl examples) and in the footer of every page.

### Changed

- A Heartbeat URL body over 8 KiB now answers 413 in plain text, like every other Heartbeat URL answer.
- HEAD on a Heartbeat URL answers 404 and records no Heartbeat, so a link preview can't keep a Monitor Up.

## [0.11.0] - 2026-11-09

### Added

- Flash messages after creating, saving, pausing, unpausing, regenerating the Heartbeat URL, deleting a Monitor, switching Alerts, saving the time zone and removing a Linked chat. Signed cookie, shown once.
- Dashboard empty state with "Create your first Monitor"; on a phone the Dashboard rows become cards.
- Copy buttons for the Heartbeat URL and separate curl GET and POST examples on the Monitor page.
- Confirmation pages before regenerating the Heartbeat URL and removing a Linked chat (deleting already had one).
- Mobile layout: full-width action buttons and wrapping curl examples.

### Changed

- Monitor page: below the settings, the Heartbeat URL and examples sit in a left column and the Incidents and Heartbeats logs in a right one; they stack on narrow screens.

## [0.10.1] - 2026-11-09

0.10.0 was tagged but never published; this is the first release with its changes (see 0.10.0 below).

### Fixed

- `package.json` formatting, which failed lint and stopped the 0.10.0 release before anything was built or deployed.

## [0.10.0] - 2026-11-09

### Added

- Design system: one static, token-based stylesheet with light and dark sets, state badges for Up/Down/New/Paused, an ECG-line logo and favicon.
- Nav bar for logged-in Users (collapses on a phone) and a footer with the running version linking to its GitHub release.
- `Content-Security-Policy: default-src 'self'` on every HTML page; assets served from `/assets/` with a long cache.
- Release pipeline: pushing a tag `vX.Y.Z` tests, builds and publishes `ghcr.io/grzegorz-grzeda/nodbeat:X.Y.Z`, deploys it to the VPS and creates a GitHub Release from this file. A manual run redeploys an existing version.
- Theme preference: a light / dark / system switch in the nav, stored on the User and applied from the first paint. Logged-out pages follow the OS theme.
- CI runs typecheck, tests and lint on every push to `main`.
- `/health` reports the running version and commit.
- Landing page at `/` for visitors without a session: tagline, how it works in 3 steps, features and a single "Log in" button. Logged-in Users still get the Dashboard.

### Changed

- All pages restyled on the new shell; the Dashboard poll script moved to `/assets/dashboard.js`.
- `/health` answers JSON `{"status","version","commit"}` instead of plain text.
- `compose.yaml` runs the prebuilt image named by `NODBEAT_VERSION` instead of building on the VPS.

## [0.9.0] - 2026-11-09

### Added

- Monitors with a Heartbeat URL; Heartbeats move a Monitor from New to Up and show the last time and message.
- Down detection about 10 s after Interval + Grace period, with Incidents and the Monitor page's Incident history and 7 days of Heartbeats.
- Telegram linking with Link codes, and the `/status` and `/unlink` bot commands.
- Monitor management: edit, regenerate the Heartbeat URL, pause, turn Alerts on or off, delete.
- Telegram Alerts when a Monitor goes Down and when it comes back Up.
- 7-day Uptime and a Dashboard that refreshes every 5 s; per-User time zone in Settings.
- Self-Heartbeat to an external URL, nightly backup script, and the deploy guide.

## [0.2.0] - 2026-11-09

### Added

- CLI command to create Users (with the Admin flag and a time zone).
- Login and logout with argon2id passwords, 30-day sliding sessions in Mongo, rate-limited login and CSRF protection.
- An empty Dashboard behind login.

## [0.1.0] - 2026-11-09

### Added

- Walking skeleton: Fastify app, configuration checked from environment variables, `/health`, Dockerfile and Compose service on the `edge` network.

[Unreleased]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.22.0...HEAD
[0.22.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.2.0...v0.9.0
[0.2.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/grzegorz-grzeda/nodbeat/releases/tag/v0.1.0
