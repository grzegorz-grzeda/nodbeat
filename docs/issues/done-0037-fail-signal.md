# 0037: Fail signal

Spec: 0007
Status: resolved

**What to build:** `GET|POST /hb/:token/fail` makes a New or Up Monitor Down at once and sends a Down Alert that says it reported a failure, with the message.

**Blocked by:** none.

- [ ] Route next to `/hb/:token` with the same message rules, body limit, plain-text answers and `HEAD` → 404
- [ ] Heartbeat doc gets `kind: "success" | "start" | "fail"` (missing = success)
- [ ] Rate limit kept per token and signal kind (1 per second each)
- [ ] New `fail` event in `src/monitor-state.ts`: New/Up → Down with `open-incident` (now) and a Down Alert if Alerts are on; New also ends its New period; Down and Paused → only recorded. Updates `lastHeartbeatAt` and `lastMessage`
- [ ] `IncidentDoc.cause: "missed" | "failed"` (missing = missed); the Down Alert for `failed` says "reported a failure" and includes the message (uses issue 0029's format if it has landed)
- [ ] Heartbeats log shows a "Signal" column (✓ / Fail)
- [ ] `api/openapi.yaml` documents the route
- [ ] `GLOSSARY.md`: add Fail signal; extend Down in Monitor state
- [ ] Pure tests of `transition` for `fail` from every state
- [ ] Tests through the HTTP seam: Up → Fail → Down Alert with the message → success → Up Alert; New → Fail → Down; Down → Fail → no second Alert; Paused → Fail → no Alert, stays Paused; Alerts off → no Alert; Fail then success within a second → both `200`; two Fails in a second → `429`
