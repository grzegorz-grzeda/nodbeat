# 0060: Free and Pro Plans

Spec: 0015
Status: resolved

**What to build:** Behind a temporary `PLANS_ENABLED` flag, each User is on Free or Pro and the Plan's limits are enforced: a Free User is refused an 11th Monitor, a 30 s Interval, a Webhook or Reminders with a "Needs Pro" message. Settings shows the Plan, its limits and usage. Existing Users get Pro for 6 months.

**Blocked by:** 0059

- [x] `plan: { proUntil, source, proEndedAt }`; effective Plan = Pro while `proUntil > now`, else Free
- [x] Free and Pro limits as in the spec 0015 table (Monitors, shortest Interval, Webhooks, Reminders)
- [x] Enforced on Monitor create (count), Monitor create/edit (Interval, Reminders), Alert channel create (Webhook); edits that don't touch a limited field always succeed
- [x] Settings shows Plan, limits and usage ("7 of 10 Monitors")
- [x] On first start with Plans enabled, every existing User gets Pro, `source: "comp"`, until now + 6 months, once; new Users start Free
- [x] Plans off → today's limits, all features on, no Plan UI anywhere
- [x] Tests for each point
- [x] "Download my data" (issue 0075) doesn't exist yet; nothing to change

## Comments

- `Plans` (`src/plans.ts`, built from `config.plansEnabled`) is passed to every module that checks a limit; `plans.limitsFor(owner, now)` is the one lookup. A missing `plan` on a User means Free.
- The launch Pro runs once per instance, recorded as `migrations._id = "plans-launch-pro"`. Users created while Plans were still off count as existing at that first start.
- Log caps don't depend on the Plan yet (issue 0062); Plans don't change Alert channel counts (10 on both).
