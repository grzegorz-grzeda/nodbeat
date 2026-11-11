# 0061: Admin gives and ends Pro

Spec: 0015
Status: ready-for-agent

**What to build:** The Admin gives a User Pro until a date, or ends it, from the per-User table, and the Admin page counts Users per Plan.

**Blocked by:** 0060

- [ ] Per-User table Plan column; "Give Pro until…" and "End Pro" via confirmation pages like Invite revoke
- [ ] Admin page counts Users per Plan
- [ ] Hidden when Plans are off
- [ ] Tests: Free User refused a Webhook, Admin gives Pro → allowed; End Pro → Free
