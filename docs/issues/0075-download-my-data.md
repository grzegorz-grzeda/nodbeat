# 0075: Download my data

Spec: 0018
Status: ready-for-agent

**What to build:** "Download my data" in Settings gives the User one JSON file with their account, Monitors, Incidents, Heartbeats (as far back as their Plan keeps them) and Alert channels, with secrets left out.

**Blocked by:** None (can start immediately).

- [ ] `POST /settings/export` (CSRF) streams `nodbeat-export-<date>.json` as an attachment, built on request, per Monitor by cursor
- [ ] Shape `{ version: 1, exportedAt, user, monitors: [{ ...settings, heartbeatUrl, incidents, heartbeats }], alertChannels }` with ISO dates
- [ ] No password hash, session id, Stripe id or channel secret anywhere in the file (`secretSet: true` instead)
- [ ] 1 export per User per hour → `429` with a Flash message saying when it's possible again
- [ ] Tests: contents complete; no secrets; second export within an hour `429`, after an hour works; another User's data never appears; User with no Monitors gets a valid file
