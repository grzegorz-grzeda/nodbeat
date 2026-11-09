# 0024: Atomic Monitor limit and Link code limit

Spec: 0004
Status: ready-for-agent

**What to build:** Parallel requests can't create more Monitors than the limit, and a User can generate at most 10 Link codes per hour.

**Blocked by:** none.

- [ ] Monitor creation counts and inserts under a per-User lock (same pattern as `MonitorLock`)
- [ ] Link code generation limited in memory to 10 per User per hour; over the limit Settings shows "Too many Link codes. Try again later." and creates nothing
- [ ] Tests through the HTTP seam: N parallel creates with room for one leave exactly one new Monitor; the 11th Link code within an hour is refused, and allowed again after the hour
