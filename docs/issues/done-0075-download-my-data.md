# 0075: Download my data

Spec: 0018
Status: done

**What to build:** "Download my data" in Settings gives the User one JSON file with their account, Monitors, Incidents, Heartbeats (as far back as their Plan keeps them) and Alert channels, with secrets left out.

**Blocked by:** None (can start immediately).

- [x] `POST /settings/export` (CSRF) streams `nodbeat-export-<date>.json` as an attachment, built on request, per Monitor by cursor
- [x] Shape `{ version: 1, exportedAt, user, monitors: [{ ...settings, heartbeatUrl, incidents, heartbeats }], alertChannels }` with ISO dates
- [x] Login methods, accepted Terms versions and Plan are included if those fields exist yet; otherwise the tickets that add them (0051, 0057, 0060) extend the export
- [x] No password hash, session id, Stripe id or channel secret anywhere in the file (`secretSet: true` instead)
- [x] 1 export per User per hour → `429` with a Flash message saying when it's possible again
- [x] Tests: contents complete; no secrets; second export within an hour `429`, after an hour works; another User's data never appears; User with no Monitors gets a valid file

## Comments

- `src/data-export.ts`: `exportStream` writes the JSON piece by piece, one Monitor at a time with its Incidents and Heartbeats by cursor. The User is an allow-list, so later fields (Login methods, Stripe ids) stay out until 0051/0065 add them on purpose.
- Plan and accepted Terms (0057, 0060 already shipped) are in the export. Plan holds only `proUntil`, `source` and `proEndedAt`.
- The hourly limit is `users.lastExportAt`, claimed by one conditional update: it holds across restarts and parallel requests.
- The `429` shows the Settings page with the message inline (role="alert") rather than a Flash cookie, since there is no redirect to carry it.
- The Heartbeat token appears only inside `heartbeatUrl`; Monitors carry no `token` field.
