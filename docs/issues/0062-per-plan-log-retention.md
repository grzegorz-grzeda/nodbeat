# 0062: Log retention by Plan

Spec: 0015
Status: ready-for-agent

**What to build:** Logs are kept by Plan: Free keeps 50 Heartbeats (7 days) and 50 Incidents per Monitor, Pro 1000 Heartbeats (90 days) and 500 Incidents. Trimming never changes Uptime.

**Blocked by:** 0060

- [ ] The instance-wide Heartbeat TTL index becomes a TTL on a per-document `expiresAt` set at intake from the owner's Plan (still one insert)
- [ ] Log pruner trims per owner's caps on the next prune
- [ ] Incidents still survive while 7-day Uptime needs them
- [ ] Plans off → today's retention
- [ ] Tests: Free User trimmed to 50 on next prune, Uptime unchanged; Pro keeps more
