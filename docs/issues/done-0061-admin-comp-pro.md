# 0061: Admin gives and ends Pro

Spec: 0015
Status: done

**What to build:** The Admin gives a User Pro until a date, or ends it, from the per-User table, and the Admin page counts Users per Plan.

**Blocked by:** 0060

- [x] Per-User table Plan column; "Give Pro until…" and "End Pro" via confirmation pages like Invite revoke
- [x] Admin page counts Users per Plan
- [x] Hidden when Plans are off
- [x] Tests: Free User refused a Webhook, Admin gives Pro → allowed; End Pro → Free

## Comments

- Routes in `src/admin-plans.ts`, registered only with Plans on (404 otherwise). The date means "Pro until that day starts" in the User's time zone, matching how Settings shows "until YYYY-MM-DD". End Pro sets `proUntil` to now; `proEndedAt` is left to the downgrade tick (0063).
