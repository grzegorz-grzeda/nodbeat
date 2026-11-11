# 0063: Pro ended notices

Spec: 0015
Status: ready-for-agent

**What to build:** When a User's Pro ends, they get an account notice to all their Alert channels and a banner on every page, and a second notice on day 12, while Webhooks, Reminders and 30 s Intervals keep working.

**Blocked by:** 0060

- [ ] New Alert kind `notice` about no Monitor, sent to all the User's Alert channels like a Test Alert but retried
- [ ] Banner on every page until dismissed
- [ ] On the down-checker tick, Users whose Pro ended get `proEndedAt` and the first notice; at +12 days a second notice; each sent once
- [ ] Over-limit Monitors keep going Down and alerting
- [ ] Tests with the fake clock: advance past `proUntil` → notice and banner, Webhook still sent; +12 d second notice
