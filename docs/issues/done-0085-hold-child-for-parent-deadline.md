# 0085: Hold a Child until its Parent's deadline

Spec: 0022
Status: resolved

**What to build:** A Child that misses its deadline while its Parent is Up but has sent nothing since the Child's last Heartbeat waits for the Parent's deadline. Parent Down → Child Unreachable; Parent Heartbeat → Child Down with its normal Alert. This stops a Child on a short Interval alerting before its Parent.

**Blocked by:** 0084

- [x] Child decision: Parent Up with a Heartbeat after the Child's last one → Down; Parent Up but silent → held, re-checked at the Parent's deadline (`nextDueAt` / `runDeadline`), repeated up the chain
- [x] Holding is derived by the down checker each pass, not stored; held Child shows as Up (late)
- [x] Parent going Down/Unreachable moves held Children to Unreachable in the same pass, before Alerts are delivered
- [x] Max run time passed on a Child is held like a missed deadline; a Fail signal never is
- [x] Seam test: router 5 min + Pi 1 min both silent → one Down Alert (router), Pi Unreachable; router alive, Pi silent → Pi Down Alert at router's deadline

## Comments

- "Re-checked at the Parent's deadline" needs no stored time: a held Child stays overdue, so every down-checker pass looks at it again, after its Parent (`parentsFirst`). The pass where the Parent goes Down makes it Unreachable; the first pass after a Parent Heartbeat makes it Down, with the Incident starting at the Child's own deadline.
- An Unreachable Child past its fresh deadline is held the same way while its Parent is silent.
