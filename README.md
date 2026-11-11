# nodbeat

A heartbeat for every service and device.

nodbeat is a small, self-hosted dead-man's switch. Each thing you want to watch (a cron job, a Raspberry Pi, an ESP32 sensor, a web service) gets a **Monitor** with a secret **Heartbeat URL**. The thing calls that URL every **Interval**. When no Heartbeat arrives within Interval + **Grace period**, the Monitor goes **Down** and nodbeat sends a Telegram **Alert**. When Heartbeats come back, it's **Up** again and you get a second Alert with how long the **Incident** lasted.

Heartbeats are push-only (ADR 0001): nodbeat never connects to what it watches, so devices behind NAT work fine. Terms are defined in [GLOSSARY.md](GLOSSARY.md).

## Features

- **Monitors** with a name, notes, Interval (30 s – 7 days) and Grace period (0 – 1 day, defaults to half the Interval). Up to 50 per User.
- **States**: New (no Heartbeat yet), Up, Down, Paused. New and Paused Monitors never go Down.
- **Pause / unpause** for maintenance. Pausing a Down Monitor closes its Incident without an Up Alert; unpausing gives a fresh Interval + Grace period.
- **Alerts on/off per Monitor**: state and Incidents are still tracked when off.
- **Regenerate the Heartbeat URL** to revoke a leaked one.
- **Dashboard** refreshing every 5 s: state, time since last Heartbeat, last message, 7-day Uptime (New and Paused time left out).
- **Monitor page**: settings, Heartbeat URL with copy buttons, curl / cron / ESP32 examples, the 20 newest Incidents and Heartbeats, and full logs of everything kept.
- **Telegram**: link private or group chats with a one-time Link code; `/status` and `/unlink` in the bot. Alerts go to every Linked chat of the Monitor's owner, in order per Monitor, retried with backoff for up to 1 hour.
- **Time zone** per User for Alerts and the UI; light / dark / system theme.
- **Admin page** at `/admin`: instance-wide counts and a per-User activity table, never what Users watch.
- **Invites**: the Admin creates single-use links (7 days) that let someone create their own User; listed and revocable at `/admin/invites`.
- **Public API docs** at `/docs` (Swagger UI) and `/openapi.yaml`.
- **Startup grace**: after nodbeat restarts, no Monitor goes Down before it has had a full Interval + Grace period, so a deploy never floods you with false Alerts (ADR 0002).

## Sending Heartbeats

`GET` or `POST` to `https://<your-nodbeat>/hb/<token>`:

```sh
curl -fsS -m 10 --retry 3 https://nodbeat.example.com/hb/<token>
curl -fsS -m 10 --retry 3 --data-raw "battery 3.7V" https://nodbeat.example.com/hb/<token>
```

An optional message (up to 200 characters) comes from, in this order: the `msg` query parameter, the `msg` field of a JSON or form body, or a plain-text body. Bodies are capped at 8 KiB.

| Answer | Meaning                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | `OK`, Heartbeat recorded (Paused Monitors too)                                                                                          |
| `404`  | unknown Heartbeat URL; `HEAD` also gets 404                                                                                             |
| `413`  | body over 8 KiB                                                                                                                         |
| `429`  | more than one Heartbeat per second for this Monitor, or this IP sent more than 30 requests to unknown Heartbeat URLs in the last minute |

All answers are plain text. Each Monitor keeps its 100 newest Heartbeats from the last 7 days, and its 100 newest Incidents (older ones are kept only while 7-day Uptime still needs them).

A cron job that reports only on success:

```cron
*/5 * * * * /path/to/job.sh && curl -fsS -m 10 --retry 3 https://nodbeat.example.com/hb/<token> > /dev/null
```

## Architecture

One always-on Node 22 process (ADR 0002) built with TypeScript, Fastify and the MongoDB driver (no ORM). Pages are server-rendered HTML with a strict CSP; the only client scripts are small files under `assets/`.

- **Web UI**: login, Dashboard, Monitors, Settings. Sessions in Mongo (30-day sliding expiry), CSRF-protected forms, argon2id password hashes. Failed logins are limited to 5 per 15 min per IP and 10 per hour per email. Settings has password change (logs out every other session) and **Log out everywhere**.
- **Heartbeat intake** (`src/heartbeats.ts`): one Monitor update plus one Heartbeat insert per request.
- **Monitor state machine** (`src/monitor-state.ts`): one pure `transition(monitor, event, now)` decides every state change and returns effects (open/close Incident, start/end New or pause periods, enqueue Alert).
- **Down checker** and **Alert dispatcher**: run on `app.tick()`, every 10 s. Alerts go through a persistent outbox in Mongo.
- **Telegram webhook** at `/telegram/webhook`, checked against `TELEGRAM_WEBHOOK_SECRET`; registered with Telegram at startup.
- **Self-Heartbeat**: optional GET to an external dead-man's switch every 60 s.
- **Storage**: MongoDB Atlas (ADR 0003). Indexes are created at startup.

`createApp` in `src/app.ts` is the composition root; `src/main.ts` wires in real Mongo, the system clock, the Telegram client and the timers.

## Configuration

All configuration comes from environment variables (see [.env.example](.env.example)). nodbeat lists every problem and exits when one is wrong.

| Variable                  | Required | Description                                                                          |
| ------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `MONGODB_URI`             | yes      | Connection string; must name the database in its path (e.g. `.../nodbeat`)           |
| `PUBLIC_BASE_URL`         | yes      | Public http(s) URL; used for Heartbeat URLs and the Telegram webhook                 |
| `SESSION_SECRET`          | yes      | At least 32 characters (`openssl rand -base64 48`)                                   |
| `TELEGRAM_BOT_TOKEN`      | yes      | Bot token from BotFather                                                             |
| `TELEGRAM_WEBHOOK_SECRET` | yes      | 1–256 characters of `A-Z a-z 0-9 _ -`                                                |
| `TRUSTED_PROXY_IP`        | yes      | IPv4/IPv6 address of the edge Caddy; only it may set the client IP (X-Forwarded-For) |
| `SELF_HEARTBEAT_URL`      | no       | External URL nodbeat sends its own Heartbeat to every minute (healthchecks.io)       |

The server listens on port 3000. `GET /health` answers `{"status":"ok","version":...,"commit":...}`, or `503` when Mongo can't be pinged.

## Creating a User

There is no public registration. Create the first User, the Admin, from the CLI; then invite others from **Admin → Invites**, or create them from the CLI too. The password is read from stdin (prompted, hidden, when interactive), so it never lands in shell history:

```sh
docker compose exec -it nodbeat node dist/cli-main.js create-user --email you@example.com --admin [--time-zone Europe/Warsaw]
```

Only `MONGODB_URI` is needed by the CLI. The time zone defaults to `Europe/Warsaw` and can be changed later in Settings.

An Invite link works once and expires after 7 days. Whoever opens it picks their email, password and time zone, and is logged in as a regular User (never an Admin). Only a hash of the link's code is stored, so the link is shown once, right after creating it.

## Linking Telegram

1. In Settings, click **Generate Link code** (8 characters, single use, valid 10 minutes).
2. In the chat you want Alerts in (private or group), send `/start <code>` to the bot.
3. Bot commands: `/status` lists your Monitors and their states; `/unlink` stops Alerts in that chat. A Linked chat is an Alert channel: Settings lists all your Alert channels, where you can rename or remove them (at most 10 per User).

## Development

Needs Node 22 and pnpm (via `corepack enable`).

```sh
pnpm install
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm lint
```

`pnpm format` fixes formatting. Tests drive the whole app through `createApp` and Fastify `inject`, with a fake clock, a recording Telegram fake and a real in-memory MongoDB (`mongodb-memory-server`); nothing below `createApp` is mocked.

To run it locally, set the variables above (a local or Atlas MongoDB works; Telegram calls fail and are only logged with a dummy token), then:

```sh
pnpm build && pnpm start
```

Specs live in [docs/specs/](docs/specs/), issues in [docs/issues/](docs/issues/), decisions in [docs/adr/](docs/adr/). Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Deploying and releasing

nodbeat runs as the Docker image `ghcr.io/grzegorz-grzeda/nodbeat` behind a shared edge Caddy (ADR 0004). Pushing a tag `vX.Y.Z` tests, builds and publishes the image as `:X.Y.Z` and `:latest` (ADR 0005); the VPS pulls `:latest` daily at 03:00 (ADR 0006). Backups are a nightly `mongodump` to Google Drive.

Step by step, including releases and rollback: [docs/deploy.md](docs/deploy.md).

## License

[MIT](LICENSE)
