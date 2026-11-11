# 0038: Start signal and Run duration

Spec: 0007
Status: resolved

**What to build:** `GET|POST /hb/:token/start` begins a Run; the next Heartbeat or Fail signal ends it and records its Run duration, shown in the Heartbeats log, on the Monitor page and on the Dashboard.

**Blocked by:** 0037.

- [ ] Route with the same rules as the other Heartbeat URL routes; `api/openapi.yaml` documents it
- [ ] New `start` event: sets `runStartedAt`; no state change; doesn't move `lastHeartbeatAt` or the deadline; a second Start replaces the first; Paused → only recorded
- [ ] Success Heartbeat and Fail signal end an open Run: Heartbeat doc gets `runDurationSec`, Monitor gets `lastRunDurationSec`, `runStartedAt` cleared
- [ ] Heartbeats log "Signal" column adds Start and a duration column; Monitor page and Dashboard (HTML and JSON) show the last Run duration when there is one
- [ ] Monitor page cron example using Start, success and Fail (from spec 0007)
- [ ] `GLOSSARY.md`: add Start signal, Run, Run duration
- [ ] Pure tests of `transition` for `start` and for success/fail ending a Run
- [ ] Tests through the HTTP seam: Start, advance 42 s, success → "42 s" in the log, Monitor page and Dashboard JSON; Start then Fail → duration recorded and Down; Start alone on a New Monitor → stays New; Start on an Up Monitor, no success → Down at the usual deadline; Start and success in the same second → both `200`
