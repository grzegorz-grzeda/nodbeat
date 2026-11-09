# Changelog

All notable changes to nodbeat are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.2.0...v0.9.0
[0.2.0]: https://github.com/grzegorz-grzeda/nodbeat/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/grzegorz-grzeda/nodbeat/releases/tag/v0.1.0
