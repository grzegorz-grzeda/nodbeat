# 0050: Reminders

Spec: 0011
Status: ready-for-agent

**What to build:** A Monitor can ask to be reminded every 1, 6 or 24 hours while it stays Down. Each Reminder repeats the Down Alert to the same Alert channels with how long it has been Down. Reminders stop on Up, pause or Alerts off.

**Blocked by:** 0044 (Webhooks receive `kind: "reminder"`).

- [ ] Monitor forms: "Remind me every 1 h / 6 h / 24 h while Down" or "Never" (default)
- [ ] A Reminder is sent like a Down Alert (loud on Telegram, high priority on ntfy, `kind: "reminder"` on Webhooks) with the Down duration and last Heartbeat message
- [ ] Timing is counted from going Down, or from switching Reminders on while already Down; a check that was late or missed sends one Reminder, never a burst
- [ ] Up, pause or Alerts off stop Reminders and drop any queued one; Fail signals don't change the timing
- [ ] The Incidents log shows how many Reminders each Incident sent
- [ ] Tests through the HTTP seam with the fake clock: 1 h cadence Down at 10:00 → 11:00, 12:00, Up at 12:30 → no more; pause stops them; switched on at 11:20 → first at 12:20; nodbeat down 11:00–15:00 → one at 15:00; Webhook gets `kind: "reminder"`
