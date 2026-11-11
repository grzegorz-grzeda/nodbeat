# 0060: Free and Pro Plans

Spec: 0015
Status: ready-for-agent

**What to build:** Behind a temporary `PLANS_ENABLED` flag, each User is on Free or Pro and the Plan's limits are enforced: a Free User is refused an 11th Monitor, a 30 s Interval, a Webhook or Reminders with a "Needs Pro" message. Settings shows the Plan, its limits and usage. Existing Users get Pro for 6 months.

**Blocked by:** 0059

- [ ] `plan: { proUntil, source, proEndedAt }`; effective Plan = Pro while `proUntil > now`, else Free
- [ ] Free and Pro limits as in the spec 0015 table (Monitors, shortest Interval, Webhooks, Reminders)
- [ ] Enforced on Monitor create (count), Monitor create/edit (Interval, Reminders), Alert channel create (Webhook); edits that don't touch a limited field always succeed
- [ ] Settings shows Plan, limits and usage ("7 of 10 Monitors")
- [ ] On first start with Plans enabled, every existing User gets Pro, `source: "comp"`, until now + 6 months, once; new Users start Free
- [ ] Plans off → today's limits, all features on, no Plan UI anywhere
- [ ] Tests for each point
- [ ] If "Download my data" (issue 0075) exists, the export includes the new User data
