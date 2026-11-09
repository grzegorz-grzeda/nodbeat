# Spec 0001: nodbeat v1

Status: ready-for-agent

## Problem Statement

I build electronics and software projects: ESP32 sensors, Raspberry Pis, cron jobs, small web services. They fail without a sound. A device loses Wi-Fi, a script stops running, a service crashes, and I only find out days later when I happen to look. Uptime tools that poll a URL can't reach my devices behind NAT. Hosted dead-man's-switch services aren't mine, and they don't fit how I want to be alerted (Telegram) or what I later want to offer other hobbyists.

## Solution

nodbeat is a self-hosted web app at `nodbeat.g2labs.pl`. I create a **Monitor** for each thing I want to watch and get a secret **Heartbeat URL**. The thing sends a **Heartbeat** (a plain HTTPS GET or POST, optionally with a short message) every **Interval**. If no Heartbeat arrives within Interval + **Grace period**, the Monitor goes **Down** and I get a Telegram **Alert**. When Heartbeats start again it comes back **Up**, and I get another Alert saying how long the **Incident** lasted. A web **Dashboard** keeps refreshing the state of all my Monitors. For now I am the only **User** (an **Admin**), but the data is owned per User from day one, so registration and paid plans can come later.

## User Stories

### Monitors

1. As a User, I want to create a Monitor with a name, Interval and Grace period, so that nodbeat knows what to expect from the thing I'm watching.
2. As a User, I want the Grace period to default to half the Interval, so that I don't have to think about it for most Monitors.
3. As a User, I want the Interval limited to 30 s–7 days and the Grace period to 0–1 day, so that I can't create a Monitor that makes no sense.
4. As a User, I want to add optional notes to a Monitor, so that I remember where the device is or what the script does.
5. As a User, I want to edit a Monitor's name, Interval, Grace period and notes, so that I can adjust it as my project changes.
6. As a User, I want a newly created Monitor to be in the New state until its first Heartbeat, so that I'm not alerted before I've finished wiring the device.
7. As a User, I want each Monitor to have its own unguessable Heartbeat URL, so that only the things I configure can send Heartbeats for it.
8. As a User, I want to regenerate a Monitor's Heartbeat URL, so that I can revoke a URL that leaked, e.g. one I committed to a public repo.
9. As a User, I want to pause a Monitor, so that planned maintenance or an unplugged device doesn't trigger Alerts.
10. As a User, I want pausing a Down Monitor to close its open Incident without an Up Alert, so that pausing doesn't produce misleading messages.
11. As a User, I want an unpaused Monitor to get a fresh Interval + Grace period from the moment I unpause it, so that it isn't Down straight away.
12. As a User, I want an unpaused Monitor to resume as Up if it sent a Heartbeat during the pause, and as New otherwise, so that its state reflects reality.
13. As a User, I want to turn Alerts off for a single Monitor while still tracking its state and Incidents, so that noisy experiments don't spam me.
14. As a User, I want to delete a Monitor, after confirming, together with its Heartbeats and Incidents, so that I can clean up projects I've abandoned.
15. As a User, I want to see only my own Monitors, so that once there are more Users, nobody sees anyone else's data.

### Heartbeats

16. As a device, I want to send a Heartbeat with a plain GET to the Heartbeat URL, so that even the simplest HTTP client can do it.
17. As a device, I want to send a Heartbeat with POST, so that clients that prefer POST work too.
18. As a device, I want to attach an optional short text message (max 200 characters) to a Heartbeat, so that I can report something like "battery 3.7V".
19. As a device, I want a `200 OK` response with body `OK`, so that I can tell my Heartbeat was accepted.
20. As a device, I want a `404` for an unknown Heartbeat URL, so that a misconfiguration is visible.
21. As a device, I want a `429` when I send more than one Heartbeat per second, so that a buggy loop can't flood nodbeat.
22. As a User, I want Heartbeats to a Paused Monitor to still be accepted and recorded, so that devices don't need to know about pauses.
23. As a User, I want the first Heartbeat to move a Monitor from New to Up without sending an Alert, so that setup is quiet.
24. As a User, I want a Heartbeat to a Down Monitor to bring it back Up and close the Incident, so that recovery is detected straight away.
25. As a User, I want raw Heartbeats kept for 7 days, so that I can inspect recent behaviour without filling the database.

### Down detection

26. As a User, I want a Monitor to go Down when Interval + Grace period passes with no Heartbeat, so that I learn about silent failures.
27. As a User, I want Down detected within about 10 s of the deadline, so that Alerts arrive on time.
28. As a User, I want Paused Monitors never to go Down, so that a pause really means silence.
29. As a User, I want New Monitors never to go Down, so that a Monitor I haven't set up yet doesn't alert.
30. As a User, I want nodbeat to give every Monitor a full Interval + Grace period after nodbeat itself restarts before marking it Down, so that a nodbeat deploy or crash doesn't flood me with false Alerts.
31. As a User, I want each Down period recorded as an Incident with start and end times, so that I have a history of failures.

### Alerts and Telegram

32. As a User, I want an Alert in Telegram when a Monitor goes Down, so that I know straight away.
33. As a User, I want an Alert in Telegram when a Monitor comes back Up, including how long the Incident lasted, so that I know it recovered and how bad it was.
34. As a User, I want to generate a Link code on the Settings page, so that I can connect a Telegram chat to my account.
35. As a User, I want to send `/start <code>` to the nodbeat bot to create a Linked chat, so that linking takes one step.
36. As a User, I want Link codes to be single-use and to expire after 10 minutes, so that a leaked code is useless.
37. As a User, I want to link several chats, including group chats, so that I can alert myself and a project group.
38. As a User, I want Alerts sent to every chat linked to the Monitor's owner, so that everyone I chose gets notified.
39. As a User, I want to send `/status` to the bot and get my Monitors and their states, so that I can check from my phone without opening the web page.
40. As a User, I want to send `/unlink` in a chat to disconnect it, so that I can stop Alerts there.
41. As a User, I want to see and remove Linked chats on the Settings page, so that I can manage them from the web too.
42. As a User, I want failed Alert sends retried with backoff for up to 1 hour, so that a short Telegram outage doesn't lose Alerts.
43. As a User, I want Alerts for one Monitor delivered in order, so that I never see "Up" before "Down".
44. As a User, I want a Down Alert that is still undelivered when the Incident ends to be dropped in favour of the Up Alert with the duration, so that I don't get stale noise.
45. As a User, I want Alert times shown in my time zone (default Europe/Warsaw), so that they're easy to read.
46. As an operator, I want the Telegram webhook to verify Telegram's secret-token header, so that nobody can impersonate Telegram.

### Web UI

47. As a User, I want to log in with my email and password, so that only I can see and manage my Monitors.
48. As a User, I want to stay logged in for 30 days of activity, so that I don't have to log in every time.
49. As a User, I want to log out, so that I can end a session on a shared computer.
50. As a User, I want a Dashboard listing my Monitors with their state, time since the last Heartbeat, last message and 7-day Uptime, so that I see everything at a glance.
51. As a User, I want the Dashboard to refresh about every 5 s without a page reload, so that it stays current while it's open.
52. As a User, I want a Monitor page with its settings, Heartbeat URL and copy-paste examples (curl, ESP32/Arduino, cron), so that wiring up a new device is quick.
53. As a User, I want the Monitor page to show its Incident history, so that I can see how reliable the thing is.
54. As a User, I want the Monitor page to show the last 7 days of Heartbeats with their messages, so that I can debug a device.
55. As a User, I want Uptime computed only over time spent Up or Down, leaving out New and Paused time, so that pauses don't count as downtime.
56. As a User, I want a Monitor that was Paused for the whole window to show "—" for Uptime, so that a number doesn't mislead me.
57. As a User, I want a Settings page with my time zone, my Linked chats and Link code generation, so that I can manage Alerts in one place.
58. As a User, I want the UI in English, so that it suits an international hobbyist audience.

### Accounts and operations

59. As the Admin, I want to create Users with a CLI command, so that I can seed my account without a registration flow.
60. As the Admin, I want passwords stored hashed with argon2id, so that a database leak doesn't expose passwords.
61. As the Admin, I want logins limited to 5 attempts per 15 minutes per IP, so that passwords can't be brute-forced.
62. As the Admin, I want every per-User limit (max Monitors, Interval bounds, history retention) defined in one place, so that Plans can drive them later.
63. As the Admin, I want nodbeat to send its own Heartbeat every minute to an external service configured by an environment variable, so that I learn when nodbeat or the VPS dies.
64. As the Admin, I want nodbeat shipped as a Docker image that joins the shared `edge` network and publishes no ports, so that the shared edge Caddy serves it over HTTPS.
65. As the Admin, I want a nightly `mongodump` (without raw Heartbeats) copied to Google Drive, so that I can recover from losing Atlas data.
66. As the Admin, I want configuration (Mongo URI, Telegram bot token and webhook secret, public base URL, external self-Heartbeat URL, session secret) read from environment variables, so that no secrets live in the repo.
67. As the Admin, I want a health endpoint, so that I can check the app is running and connected to Mongo.

## Implementation Decisions

- **Runtime and stack**: Node 22, TypeScript, Fastify, the official MongoDB driver, no ORM. Pages are rendered on the server. A small client-side TypeScript script polls a JSON endpoint to refresh the Dashboard. pnpm, Vitest, ESLint + Prettier. SemVer, starting at `0.1.0`, with git tags `vX.Y.Z`.
- **Single process** (ADR 0002): one always-on process holds the web UI, Heartbeat intake, Telegram webhook, Down checker, Alert dispatcher and self-Heartbeat. A single instance is assumed, with no distributed locking.
- **Composition root**: `createApp({ db, clock, telegram, config })` builds the Fastify instance and every module. `clock` provides "now". `telegram` is a small client interface (send message, set webhook). The real `main` wires in the real Mongo, the system clock, the HTTP Telegram client and a timer that calls `tick()` every 10 s, plus the self-Heartbeat timer.
- **Modules**:
  - **Monitors**: CRUD, ownership checks, pause/unpause, regenerating the Heartbeat URL, Alerts toggle. Enforces limits through the Limits module.
  - **Heartbeat intake**: resolves the token to a Monitor, rate-limits per token (in memory, 1/s), caps the message at 200 characters, records the Heartbeat, and applies the state transition (New→Up, Down→Up closes the Incident). Each Heartbeat does at most one Monitor update plus one Heartbeat insert, with an extra Incident write on recovery.
  - **Monitor state machine**: a single pure transition function `(monitor, event, now) → (monitor', effects)` handles the events heartbeat, deadline-check, pause, unpause and edit. Effects are open-Incident, close-Incident and enqueue-Alert. Intake, the checker and the Monitors module all go through it.
  - **Down checker**: `tick()` finds Up Monitors whose deadline (last Heartbeat + Interval + Grace, or startup time + Interval + Grace, whichever is later) has passed, and transitions them to Down. It ignores New and Paused Monitors. The process start time is held in memory to apply the startup grace rule.
  - **Alerts**: a persistent outbox in Mongo (per Monitor, in order). A dispatcher runs on each `tick()` and sends to all Linked chats of the owner, retrying with exponential backoff for up to 1 h before giving up with a log entry. A pending Down Alert is dropped when its Incident closes. No Alerts are created when the Monitor's Alerts are off. Messages are formatted in the owner's time zone.
  - **Telegram**: the webhook route checks the `X-Telegram-Bot-Api-Secret-Token` header and handles `/start <code>`, `/status` and `/unlink`. Link codes are 8 characters, single-use, with a 10-minute TTL.
  - **Auth**: Users in Mongo with argon2id hashes. Sessions are stored in Mongo with a 30-day sliding expiry and an HttpOnly, Secure, SameSite=Lax cookie. Login is rate-limited to 5 per 15 min per IP. Includes a CLI command for creating a User, with an Admin flag.
  - **Limits**: one module exposing per-User limits (max Monitors, Interval and Grace bounds, Heartbeat retention). For now it returns constants. Plans will feed it later.
  - **Uptime**: computes Uptime for a window from Incidents and pause periods. Returns "—" when there was no Up or Down time.
  - **Self-Heartbeat**: if the env var is set, sends a GET to the external URL every 60 s. Failures are only logged.
- **Data model (MongoDB collections)**:
  - `users`: email (unique), password hash, isAdmin, timeZone (default `Europe/Warsaw`), createdAt.
  - `sessions`: id, userId, expiresAt (TTL index).
  - `monitors`: ownerId, name, notes, intervalSec, graceSec, state (`new|up|down|paused`), token (unique index), alertsEnabled, lastHeartbeatAt, lastMessage, pausedAt, createdAt. Also records pause periods, or pause start/end events, for the Uptime calculation.
  - `heartbeats`: monitorId, receivedAt (TTL index, 7 days), message, method, source IP.
  - `incidents`: monitorId, ownerId, startedAt, endedAt, endReason (`heartbeat|paused`).
  - `linkedChats`: ownerId, telegram chatId, title, linkedAt. Unique on (ownerId, chatId).
  - `linkCodes`: code, ownerId, expiresAt (TTL index), used.
  - `alertOutbox`: monitorId, ownerId, kind (`down|up`), incidentId, payload, attempts, nextAttemptAt, status.
- **HTTP contract**:
  - Heartbeat: `GET|POST /hb/:token`. The message comes from the `msg` query parameter or a plain-text/JSON body field `msg`. Returns `200 OK`, `404` or `429`.
  - Telegram webhook: `POST /telegram/webhook`.
  - The Dashboard JSON endpoint returns the User's Monitors with state, lastHeartbeatAt, lastMessage and 7-day Uptime.
  - `GET /health` returns ok when Mongo can be pinged.
  - HTML routes cover login/logout, the Dashboard, Monitor create/edit/detail/delete, and Settings. Every state-changing form is CSRF-protected.
- **Storage** (ADR 0003): a new Atlas project `nodbeat` with an M0 cluster in Frankfurt. Raw Heartbeats are removed after 7 days by a TTL index. Indexes are created at startup.
- **Deployment** (ADR 0004): multi-stage Dockerfile and a Compose file whose service joins the external `edge` network as `nodbeat:3000`. No ports are published. TLS is terminated by the shared edge Caddy (separate repo).
- **Heartbeats are push only** (ADR 0001). nodbeat never makes requests to monitored things.

## Testing Decisions

- **One seam**: tests build the full app via `createApp` and drive it only through HTTP (Fastify `inject`): Heartbeat URLs, HTML and JSON routes, login, and the Telegram webhook. Time moves only through an injected fake clock, and the checker and dispatcher are triggered by calling `app.tick()`. Telegram is a recording fake that captures sent Alerts and can be set to fail, so retries can be tested. MongoDB is real, via `mongodb-memory-server`. Nothing below `createApp` is mocked.
- **What a good test is**: it asserts on behaviour visible from outside, such as HTTP status and body, what the Dashboard JSON reports, which Alerts the Telegram fake received and in what order. It never asserts on collection contents or internal function calls. Tests read like scenarios. For example: "create Monitor (60 s / 30 s), send Heartbeat, advance 91 s, tick → Down Alert sent; send Heartbeat → Up Alert with duration."
- **Scenarios to cover**:
  - the New→Up→Down→Up lifecycle
  - New never goes Down
  - pause/unpause, including pausing while Down
  - Alerts off
  - startup grace after a restart (a new `createApp` on the same DB with the clock moved ahead)
  - rate limit and message cap
  - unknown token
  - regenerating the Heartbeat URL invalidates the old one
  - ownership isolation between two Users
  - Link code flow, expiry and reuse
  - `/status` and `/unlink`
  - Telegram webhook secret rejection
  - Alert retry/backoff, give-up after 1 h, and in-order delivery
  - a pending Down Alert dropped on recovery
  - Uptime with and without Paused time
  - login rate limit and session expiry
  - delete cascades
  - limits enforcement
- **Prior art**: none. The repo has no code yet, so these tests set the pattern.

## Out of Scope

- Pull checks, where nodbeat polls a URL (possible later as a second kind of Monitor).
- Public registration, password reset, OAuth and multiple Admins.
- Plans (free vs paid), billing and quotas beyond the Limits module.
- Alert channels other than Telegram (email, push, webhooks).
- Metrics or structured payloads in Heartbeats, and charts.
- Tags or groups of Monitors, public status pages and shared Monitors.
- Flapping suppression beyond the Grace period. Escalation and repeated reminders.
- Multiple nodbeat instances and high availability.
- An admin panel.
- Setting up the shared edge Caddy itself. It lives in a separate repo, `grzegorz-grzeda/edge`.

## Further Notes

- The VPS is small (2 GB RAM, 1 vCPU) and also hosts take-a-look. Keep memory use modest.
- Domain vocabulary is defined in `GLOSSARY.md`. Decisions are in `docs/adr/0001`–`0004`.
- Manual setup outside the code: create the Telegram bot with BotFather, create the Atlas project and M0 cluster, add the DNS record for `nodbeat.g2labs.pl`, create an external self-Heartbeat check (e.g. healthchecks.io), and configure the backup cron with `rclone`.
