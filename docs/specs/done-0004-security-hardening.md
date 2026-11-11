# Spec 0004: Security hardening

Status: resolved

## Problem Statement

A security and abuse review of v0.12.0 found holes that matter even while I'm the only User:

- Anything on the shared `edge` Docker network (e.g. take-a-look) can connect to nodbeat directly and set its own `X-Forwarded-For`, because every direct peer is trusted as a proxy. That makes the login limit and recorded source IPs worthless against a compromised neighbour.
- Login is limited per IP only, counts successful logins too, and a stolen session cookie can't be revoked: there's no password change and no way to log out other sessions.
- Anyone on the internet can hammer `/hb/<random>`. Every unknown token costs a round trip to Atlas M0 before any limiter runs.
- Responses lack HSTS, `nosniff`, a Referrer-Policy and clickjacking protection. CSP is sent on HTML only.
- The Telegram bot tells anyone in a linked group which emails are linked and what their Monitors are called, any group member can `/unlink` everyone, and a chat that blocked or kicked the bot is retried for an hour on every Alert.
- The Monitor limit can be passed with parallel requests, Link codes can be generated without limit, backups on Google Drive are unencrypted, and CI never checks dependencies for known vulnerabilities.

## Solution

Close each hole with the smallest change that keeps the existing behaviour for legitimate use. No new concepts in the domain: Users, Monitors and Linked chats keep working as today. Everything stays in one process (ADR 0002), so limits stay in memory.

## User Stories

1. As the Admin, I want nodbeat to trust `X-Forwarded-For` only from the edge Caddy, so that a neighbour on the `edge` network can't fake its IP.
2. As a User, I want only failed logins to count towards the login limit, so that logging in on several devices doesn't lock me out.
3. As a User, I want failed logins also limited per email (10 per hour), so that guessing my password from many IPs is slow.
4. As a User, I want to change my password from Settings by giving the current one, so that I can replace a password I think leaked.
5. As a User, I want changing my password to log out all my other sessions, so that whoever had my old password or a stolen cookie is thrown out.
6. As a User, I want a "Log out everywhere" button, so that I can end every session, including a stolen one, at once.
7. As the Admin, I want more than 30 unknown-Heartbeat-URL requests per minute from one IP answered `429` without touching the database, so that scanning Heartbeat URLs can't load Atlas.
8. As a User, I want every response sent with HSTS, `nosniff`, `Referrer-Policy: same-origin` and a CSP that forbids framing, so that browsers protect my session.
9. As a User, I want the bot never to show my email in a chat, so that group members don't learn it.
10. As a User, I want `/status` and `/unlink` in a group to work only for that group's Telegram admins, so that any member can't read my Monitors or cut off my Alerts.
11. As a User, I want a chat that blocked or kicked the bot to be unlinked as soon as Telegram says so, so that Alerts to my other chats aren't held up by retries.
12. As a User, I want the Monitor limit to hold even for parallel requests, so that the limit means what it says.
13. As the Admin, I want at most 10 Link codes per User per hour, so that the Settings form can't be used to flood the database.
14. As the Admin, I want backups encrypted before they leave the VPS, so that a leaked Google Drive doesn't leak emails and password hashes.
15. As the Admin, I want CI to fail on known vulnerabilities in production dependencies, so that I learn about them before a release.

## Implementation Decisions

- **Trusted proxy**: a new required env var `TRUSTED_PROXY_IP`. Fastify's `trustProxy` trusts only that address. The edge Caddy gets a fixed IP on the `edge` network, which is set in the `grzegorz-grzeda/edge` repo. `docs/deploy.md` and `.env.example` describe it.
- **Login limits**: only failed attempts are counted. The limit stays at 5 per 15 min per IP, plus 10 per hour per normalised email. Either limit answers `429` with the same message. A known consequence: someone who knows my email can lock out password login for up to an hour. Sessions that are already open are not affected. This is accepted.
- **Password change**: a form on Settings with current password, new password and its confirmation. The minimum length is the same as `createUser`. A wrong current password counts as a failed login against both limits. On success the password hash is replaced, every other session of the User is deleted, and the current session stays.
- **Log out everywhere**: a button on Settings (POST with CSRF) that deletes every session of the User, including the current one, then redirects to `/login`.
- **Unknown Heartbeat URLs**: an in-memory per-IP limiter of 30 unknown-token hits per minute. When an IP is over the limit, any `/hb/:token` request from it is answered `429` before the database lookup. Known tokens keep their 1/s limit. The OpenAPI document mentions this `429`.
- **Headers**: one `onSend` hook sets these on every response: `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`, since other `g2labs.pl` subdomains aren't nodbeat's), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, and `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. The Swagger UI page must keep working under it.
- **Telegram**:
  - Bot replies never contain an email. A successful `/start` says the chat is linked to "your nodbeat account". In a group linked by several Users, `/status` sections are numbered, not labelled by email.
  - In non-private chats, `/status` and `/unlink` first call `getChatMember` for the sender. Only `creator` and `administrator` get an answer. Anyone else gets a short refusal. `TelegramClient` gains `getChatMember`.
  - `/start` stays open to any member, since it needs a valid Link code anyway.
  - When `sendMessage` fails with HTTP 403, the dispatcher unlinks that chat (all its Links) at once, does not retry it, and logs it. `TelegramClient.sendMessage` reports 403 distinctly from other failures.
- **Monitor limit**: counting and inserting happen under a per-User lock, like `MonitorLock` but keyed by User, so parallel creates can't pass `maxMonitors`.
- **Link codes**: at most 10 per User per hour, in memory. Over the limit, the Settings page shows an error and creates no code.
- **Backups**: `scripts/backup.sh` pipes the archive through `age` to a recipient from the env var `BACKUP_AGE_RECIPIENT` and uploads `*.archive.gz.age`. The script refuses to run without a recipient. `docs/deploy.md` covers generating the key, keeping the private key off the VPS, and restoring.
- **CI**: the CI workflow runs `pnpm audit --prod --audit-level=high`.
- **Unchanged on purpose**: `/health` keeps reporting version and commit, because the release workflow waits for the version there.

## Testing Decisions

- Same single seam as spec 0001: the full app through `createApp` and Fastify `inject`, a fake clock, the recording Telegram fake and real Mongo in memory.
- The Telegram fake learns to fail `sendMessage` with 403 and to answer `getChatMember` with a given status.
- The proxy test injects requests with a `remoteAddress` that is not `TRUSTED_PROXY_IP` plus a forged `X-Forwarded-For`, and checks that the login limit still applies to the real peer.
- Backups and CI are checked by running them, not by Vitest.

## Out of Scope

- 2FA (TOTP, passkeys, recovery codes).
- Public registration, OAuth logins, Plans and billing.
- Flapping suppression and per-User Alert budgets.
- A session list, an audit log and changes to how source IPs are stored.
- Moving limits out of memory or running more than one instance.
