# 0007: Alerts

Spec: 0001
Status: ready-for-agent

**What to build:** When one of my Monitors goes Down, every Linked chat of mine gets a Telegram Alert. When it comes back Up, they get an Alert saying how long the Incident lasted.

**Blocked by:** 0004, 0005, 0006.

- [x] Down and Up transitions put an Alert in a persistent outbox; `tick()` dispatches it to all of the owner's Linked chats
- [x] The Up Alert includes the Incident duration; times are shown in the owner's time zone
- [x] No Alert for New→Up, when the Monitor's Alerts are off, or when pausing closes an Incident
- [x] A failed send is retried with exponential backoff for up to 1 hour, then dropped with a log entry (test with the Telegram fake set to fail)
- [x] Alerts for the same Monitor are delivered in order
- [x] A Down Alert still pending when its Incident closes is dropped; only the Up Alert is sent
- [x] Pending Alerts survive an app restart (new `createApp` on the same DB)
