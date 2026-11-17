# 0082: Change Alerts

Spec: 0021
Status: resolved

**What to build:** A per-Monitor option sends a Change Alert (old → new) to the Monitor's Alert channels when a plain Heartbeat's message differs from the last one that had a message.

**Blocked by:** None (can start immediately)

- [x] `changeAlerts` toggle on the Monitor form, off by default, on every Plan
- [x] Baseline of the last non-empty plain Heartbeat message, updated always (also while Paused or Alerts off); a null baseline only sets it
- [x] State machine emits a `change` Alert after any Up Alert; no state, Incident or Uptime effect
- [x] `change` Alert kind: quiet, 🔄, ntfy priority 3; never a Reminder; dropped like others on pause/Alerts off
- [x] Telegram/ntfy text `Name has a new message` / `old → new`
- [x] Webhook `kind: "change"`, `previousMessage`, `incidentId: null`; `api/openapi.yaml` updated
- [x] API docs, landing feature list, CHANGELOG
