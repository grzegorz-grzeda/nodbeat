# 0062: Log retention by Plan

Spec: 0015
Status: done

**What to build:** Logs are kept by Plan: Free keeps 50 Heartbeats (7 days) and 50 Incidents per Monitor, Pro 1000 Heartbeats (90 days) and 500 Incidents. Trimming never changes Uptime.

**Blocked by:** 0060

- [x] The instance-wide Heartbeat TTL index becomes a TTL on a per-document `expiresAt` set at intake from the owner's Plan (still one insert)
- [x] Log pruner trims per owner's caps on the next prune
- [x] Incidents still survive while 7-day Uptime needs them
- [x] Plans off → today's retention
- [x] Tests: Free User trimmed to 50 on next prune, Uptime unchanged; Pro keeps more

## Comments

- Intake does one User read per Heartbeat with Plans on (none with Plans off) to set `expiresAt`; still one insert. `ensureHeartbeatIndexes` drops the old `receivedAt_1` TTL, back-fills `expiresAt` (receivedAt + 7 d) and keeps a plain `receivedAt` index for the Admin counts.
- A Pro User who goes Free keeps old Heartbeats until their 90-day `expiresAt`, but pages show only the Free window and the pruner trims to 50 on the next Heartbeat.
