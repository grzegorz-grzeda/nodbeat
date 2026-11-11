# 0064: Pro-only features go dormant

Spec: 0015
Status: ready-for-agent

**What to build:** 14 days after Pro ended, Pro-only features go dormant without deleting anything: Webhooks shown "Needs Pro" and no longer sent to, Reminders off, 30 s Monitors moved to 1 min. Getting Pro back clears "Needs Pro".

**Blocked by:** 0063

- [ ] Runs once per ended Pro at +14 days on the tick
- [ ] Webhook channels flagged `needsPro`; the Alert dispatcher skips them; Settings shows "Needs Pro"
- [ ] Reminders cleared; 30 s Intervals raised to 60 s through the normal edit path
- [ ] Upgrading clears `needsPro`; Reminders and Intervals aren't restored
- [ ] Tests: +14 d Webhook skipped and shown "Needs Pro", Reminders off, 30 s → 60 s; Pro again → Webhook sent
