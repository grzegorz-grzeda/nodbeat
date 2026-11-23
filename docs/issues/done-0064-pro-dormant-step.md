# 0064: Pro-only features go dormant

Spec: 0015
Status: done

**What to build:** 14 days after Pro ended, Pro-only features go dormant without deleting anything: Webhooks shown "Needs Pro" and no longer sent to, Reminders off, 30 s Monitors moved to 1 min. Getting Pro back clears "Needs Pro".

**Blocked by:** 0063

- [x] Runs once per ended Pro at +14 days on the tick
- [x] Webhook channels flagged `needsPro`; the Alert dispatcher skips them; Settings shows "Needs Pro"
- [x] Reminders cleared; 30 s Intervals raised to 60 s through the normal edit path
- [x] Upgrading clears `needsPro`; Reminders and Intervals aren't restored
- [x] Tests: +14 d Webhook skipped and shown "Needs Pro", Reminders off, 30 s → 60 s; Pro again → Webhook sent

## Comments

- `src/plan-dormant.ts`, run from the Plan-notices tick and claimed through `plan.dormantAt`. Monitors change under their lock through the `edit` transition plus `rescheduleReminder`, as the edit route does.
- The dispatcher treats a dormant Webhook as done with, so Alerts are not kept for it. `giveComp` wakes Webhooks; Stripe (0065) must call `wakeProFeatures` too.
