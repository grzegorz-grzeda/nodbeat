# 0059: Per-owner limits (prefactor)

Spec: 0015
Status: ready-for-agent

**What to build:** Prefactor with no visible change: every limit check goes through `limitsFor(owner, now)`, and `maxLogRowsPerMonitor` splits into `maxHeartbeatsPerMonitor` and `maxIncidentsPerMonitor`, read per owner by the log pruner and log pages.

**Blocked by:** None (can start immediately).

- [ ] `limitsFor(owner, now)` returns limits plus `features: { webhooks, reminders }` (all on for now); every check uses it, keyed by owner
- [ ] Log pruner and log pages read per-owner Heartbeat and Incident caps
- [ ] No behaviour change: existing tests pass unchanged
