# 0063: Pro ended notices

Spec: 0015
Status: done

**What to build:** When a User's Pro ends, they get an account notice to all their Alert channels and a banner on every page, and a second notice on day 12, while Webhooks, Reminders and 30 s Intervals keep working.

**Blocked by:** 0060

- [x] New Alert kind `notice` about no Monitor, sent to all the User's Alert channels like a Test Alert but retried
- [x] Banner on every page until dismissed
- [x] On the down-checker tick, Users whose Pro ended get `proEndedAt` and the first notice; at +12 days a second notice; each sent once
- [x] Over-limit Monitors keep going Down and alerting
- [x] Tests with the fake clock: advance past `proUntil` → notice and banner, Webhook still sent; +12 d second notice

## Comments

- `src/plan-notices.ts` runs on every tick after the down checker. `plan.proEndedAt` is when the tick noticed (not `proUntil`), so the 12 and 14 days count from the first notice. `plan.endNotices` (1, 2) claims each notice before sending; `plan.bannerDismissed` is reset by each notice.
- The banner stops at day 14; what happens then is issue 0064. `giveComp` replaces the whole `plan`, so Pro given again clears all of this.
