# 0059: Per-owner limits (prefactor)

Spec: 0015
Status: resolved

**What to build:** Prefactor with no visible change: every limit check goes through `limitsFor(owner, now)`, and `maxLogRowsPerMonitor` splits into `maxHeartbeatsPerMonitor` and `maxIncidentsPerMonitor`, read per owner by the log pruner and log pages.

**Blocked by:** None (can start immediately).

- [x] `limitsFor(owner, now)` returns limits plus `features: { webhooks, reminders }` (all on for now); every check uses it, keyed by owner
- [x] Log pruner and log pages read per-owner Heartbeat and Incident caps
- [x] No behaviour change: existing tests pass unchanged

## Comments

- `features` lives on `Limits` itself. The Heartbeat TTL (`heartbeatRetentionSec`) and the Admin's Monitor setup summary still read `instanceLimits()`: per-owner retention is issue 0062.
- The log pruner looks up each marked Monitor's owner at prune time; a Monitor or owner deleted meanwhile is skipped.
