# Changelog

All notable changes to nodbeat are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Terms and Privacy pages: with the new optional `LEGAL_DIR` set, `/terms` and `/privacy` show the Operator's own `terms.md` and `privacy.md` (front-matter `version` date and `summary`), rendered at startup with a small Markdown subset (headings, paragraphs, lists, links; raw HTML shows as text). `operator.md` holds the Operator's name, address, contact email and optional `taxId` (shown as "Tax ID"): `/terms` starts with them, and the footer of every page names the Operator and links to both pages. With `LEGAL_DIR` unset or a file missing there are no pages (`404`), footer links or Operator details (with `LEGAL_DIR` set, startup logs a warning naming the missing files); a malformed file stops startup with its name. Links in the Markdown go only to `http(s)://`, `mailto:`, `#` or a path on this site; anything else, `//host` included, shows as text. No legal text ships in the repo or the image: `compose.yaml` mounts `./legal` read-only at `/legal` (see `docs/deploy.md`).
- Accepting the Terms on an Invite: with the legal files in place, the Invite accept page has a required "I accept the Terms and Privacy policy" checkbox linking to both pages. Without it no User is created and the Invite stays usable. The new User's accepted versions and the time are stored as `users.accepted: { terms: { version, at }, privacy: { version, at } }`. Users created with the CLI (`create-user`) and existing Users have no acceptance recorded yet.
- Re-accepting changed Terms: when `terms.md` or `privacy.md` has a newer `version` than the one a User accepted (or they accepted none: CLI-created and existing Users, on their first login), their next page load goes to `/accept-terms`. It shows each changed document's version and `summary` with a link to it; "Accept and continue" records the new versions (an unchanged document keeps its earlier time) and returns to the page they asked for, only ever a path on this site. A version that changed again while the page was open is asked for again rather than recorded unseen. Only the app's own pages, loaded with GET, are redirected: anything else (Heartbeat URLs, `/dashboard.json`, the Schedule preview, assets, `/docs`, `/openapi.yaml`, `/health`, redirects), `/terms`, `/privacy`, error pages, form posts (logout included) and the Telegram webhook work as before, and Alerts are never held back. Without the legal files nothing changes and `/accept-terms` doesn't exist.

## [0.26.1] - 2026-11-11

### Fixed

- CI: the test MongoDB no longer runs its TTL monitor, which deleted test sessions by the real wall clock (the tests use a fake clock) and made slow runs fail. No change to nodbeat itself; 0.26.0's CI run failed this way.

## [0.26.0] - 2026-11-11

### Added

- Reminders: on the create and edit forms a Monitor can choose "Remind me every 1 h / 6 h / 24 h while Down" or "Never" (the default; existing Monitors keep it). While the Monitor stays Down, each Reminder repeats the Down Alert to the same Alert channels ("is still Down", how long it has been Down and the last Heartbeat message), as loud as a Down Alert: with sound on Telegram, priority 5 on ntfy, `kind: "reminder"` on Webhooks (documented in `/openapi.yaml`). Reminders count from going Down, or from switching them (or Alerts) on while already Down; changing the cadence while Down counts the next one from the change. A tick missed while nodbeat wasn't running sends one Reminder, never a burst. Fail signals during the Down don't change the timing. Up, pause or Alerts off stop Reminders and drop a queued one. The Monitor page shows the cadence, and the Incidents log how many Reminders each Incident sent.

## [0.25.0] - 2026-11-11

### Added

- The Monitor page and Dashboard (and its live update, as `nextExpectedAt` and `nextExpectedText` in `/dashboard.json`) show when each New or Up Monitor's next Heartbeat is expected by, in the User's time zone, with the date when it isn't today; nothing for Paused or Down Monitors. It is the same time the Down checker uses: an Up Monitor goes Down in that minute. A Run's Max run time stays a separate deadline and isn't shown here.
- Schedules: a Monitor can have a Schedule instead of an Interval, chosen on the create and edit forms. A Schedule is a 5-field cron expression (ranges, lists, steps, `MON`/`JAN` names; no seconds, `@` names or `L`/`W`/`#`) in a time zone chosen per Monitor (default: the User's), DST included: a scheduled time skipped by the change is an hour later, one in a repeated hour is there once. The form shows the next three scheduled times as the User types. Invalid expressions, ones with no scheduled times and ones whose closest two scheduled times are less than 5 min apart (looked at over a whole year, so across both DST changes) are rejected with a clear error. Parsed with [croner](https://github.com/hexagon/croner) (no dependencies).
- A Schedule Monitor is due Grace period after the scheduled time it waits for, and goes Down then. A Heartbeat counts for the coming scheduled time if it is at most 1 h before it (or half the gap from the scheduled time before, if that is shorter), otherwise for the scheduled time before it; the Monitor then waits for the scheduled time after the one it counted for. So a 02:00 job that sends at 01:58 is fine, a rerun by hand at 16:00 after a missed 02:00 doesn't excuse tomorrow's 02:00, and a weekday job stays Up at the weekend. The default Grace period is half the shortest gap between scheduled times, clamped to the Grace bounds. "Next expected by" shows the same time.
- Switching a Monitor between Interval and Schedule keeps its Incidents, logs and Uptime, and counts the deadline from the switch. The Monitor page shows the Schedule and uses it in the cron examples. The Admin page's Monitor setup breakdown ("Monitors by Interval or Schedule") counts Schedule Monitors as their own group.

## [0.24.0] - 2026-11-11

### Added

- Webhook Alert channels: add one in Settings with a URL, an optional name and an optional secret, and edit its URL and secret later (the secret is never shown again: "secret set"; moving the URL to another host removes it unless a new one is typed, and the Flash message says so). Down and Up Alerts are POSTed as JSON (`monitor`, `kind`, `at`, `message`, `incidentId`; `kind` is `down`, `up` or `test`), signed in `X-Nodbeat-Signature: sha256=<HMAC>` when a secret is set. Any `2xx` counts, within 5 s; redirects aren't followed. Documented as a webhook in `/openapi.yaml` (now OpenAPI 3.1).
- ntfy topic Alert channels: add one in Settings with its full topic URL (ntfy.sh or self-hosted), an optional name (defaults to the topic) and an optional access token, and edit its URL and token later (the token is never shown again: "token set"; moving the URL to another host removes it unless a new one is typed). Alerts are POSTed as plain text with the Monitor name and state as title, priority 5 for Down and 2 for Up, a click link to the Monitor page, and `Authorization: Bearer <token>` when a token is set. "Send test" works for ntfy topics too, at ntfy's default priority 3.
- Webhook and ntfy URLs whose host resolves to a private or reserved address are refused on save and before every send: private, loopback, link-local, CGNAT, unique-local, documentation (TEST-NET), benchmarking, multicast, reserved and broadcast addresses (IPv4 or IPv6), and the IPv4-tunnelling prefixes NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`) and Teredo (`2001::/32`).
- Retries are per Alert channel: each channel backs off on its own (exponential, 1-hour window) and gets a Monitor's Alerts in order, so a failing Webhook or ntfy topic doesn't hold back that Monitor's Alerts to the other channels. Queued Alerts keep their retry state when moved over at startup.
- Failing: an Alert channel whose Alert still fails when the 1-hour retry window runs out is marked Failing in Settings, with the last error. It keeps getting later Alerts; the next one delivered clears Failing.
- Each Monitor chooses its Alert channels on the create and edit forms: "All Alert channels" (the default, including ones added later; existing Monitors keep it) or a chosen few. Only the User's own channels are accepted. Alerts go only to the chosen channels, and `/status` in a Telegram chat lists only the Monitors whose Alert channels include that chat ("No Monitors alert this chat." otherwise). The Monitor page shows the Monitor's Alert channels.
- Removing an Alert channel takes it out of every Monitor's chosen list; an emptied list stays chosen. A Monitor with no Alert channels shows "Alerts go nowhere" on its page and the Dashboard (`alertsGoNowhere` in `/dashboard.json`).
- "Send test" on every Alert channel in Settings sends a test Alert at once (not queued, no retries) and shows in a Flash message whether it got through, with the error if not. A test that gets through clears Failing. At most 5 tests per User per minute.

### Changed

- Linked chats are now Alert channels. Settings has one "Alert channels" list showing each channel's kind ("Linked chat", "Webhook", "ntfy topic") and name, where a channel can be renamed or removed. Relinking a chat keeps the name it was given. Existing Linked chats and queued Alerts are moved over at startup.
- A User can have at most 10 Alert channels. Linking a chat past the limit gets a bot reply asking to remove one first.

## [0.23.0] - 2026-11-11

### Added

- Fail signal: `GET|POST /hb/<token>/fail` (optional message, same rules as a Heartbeat) makes a New or Up Monitor Down at once. Its Down Alert says the Monitor "reported a failure" and includes the message. A Fail signal to a Down Monitor is only recorded; to a Paused Monitor it is only logged (it neither counts as hearing from the Monitor nor ends a Run). The next Heartbeat brings the Monitor Up.
- Start signal: `GET|POST /hb/<token>/start` says a job began. The next Heartbeat or Fail signal ends the Run and records its Run duration, shown in the Heartbeats log ("Run duration" column), on the Monitor page and on the Dashboard ("Last Run" column; `lastRunDurationSec` and `lastRunDurationText` in `/dashboard.json`). A Start signal is not a Heartbeat: it changes no state and does not move the deadline. A Start signal to a Paused Monitor is only recorded.
- Max run time: an optional Monitor setting (1 min to 1 d; empty = none) on the create and edit forms. An Up Monitor whose Run lasts longer goes Down, the Incident starting when the Max run time passed, with a Down Alert saying it "ran longer than" the Max run time in force then (kept on the Incident). Startup grace applies; a changed Max run time counts from the edit.
- The Monitor page has a cron example using Start, success and Fail.
- The Heartbeats log has a "Signal" column (✓ / Start / Fail).

### Changed

- The 1-per-second limit on a Heartbeat URL is counted per signal kind, so a Start signal, a Fail signal and a Heartbeat in the same second all get through.

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

[Unreleased]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.26.1...HEAD
[0.26.1]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.26.0...v0.26.1
[0.26.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.22.0...v0.23.0
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
