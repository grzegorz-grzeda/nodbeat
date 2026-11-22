# 0086: Parent Down Alert lists Unreachable Children

Spec: 0022
Status: resolved

**What to build:** A Parent's Down Alert names the Children that are Unreachable when it is sent, so the User knows what is affected.

**Blocked by:** 0085

- [x] Telegram and ntfy Down Alert: "Also unreachable: Pi, NAS" (nothing when none)
- [x] Webhook `unreachableChildren: [{ id, name }]`, empty for other kinds and Monitors; `api/openapi.yaml` updated (additive)
- [x] Up Alert unchanged
- [x] In-app API docs, landing feature list, CHANGELOG
- [x] Seam tests on Telegram, ntfy and a Webhook

## Comments

- Alert text is fixed when an Alert is enqueued, so the down checker defers Down Alerts to the end of its pass (`applyEffects(..., { deferDownAlert: true })` then `sendDeferredDownAlert`). An Incident that closed in between gets no Down Alert, as a Heartbeat would have dropped a pending one.
- A Fail signal's Down Alert names whatever Children are Unreachable at that moment (usually none).
