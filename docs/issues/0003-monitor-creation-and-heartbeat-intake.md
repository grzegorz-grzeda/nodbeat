# 0003: Monitor creation and Heartbeat intake

Spec: 0001
Status: ready-for-agent

**What to build:** I create a Monitor, copy its Heartbeat URL, curl it, and see the Monitor go from New to Up on the Dashboard, along with the last Heartbeat time and message.

**Blocked by:** 0002.

- [ ] Create a Monitor with name, Interval, Grace period (default half the Interval) and optional notes; the bounds (Interval 30 s–7 days, Grace period 0–1 day, max Monitors) come from a single Limits module
- [ ] The Monitor page shows the Heartbeat URL and copy-paste curl, ESP32/Arduino and cron examples
- [ ] `GET|POST /hb/:token` records a Heartbeat with its optional message (query `msg` or body), truncated to 200 characters; answers `200 OK`
- [ ] Unknown token → 404; more than 1 Heartbeat per second per token → 429
- [ ] Raw Heartbeats expire after 7 days (TTL index)
- [ ] Monitor state transitions go through one pure state-machine function; the first Heartbeat moves New→Up
- [ ] The Dashboard lists my Monitors with state, time since last Heartbeat and last message
- [ ] A User can't see or touch another User's Monitors (test with two Users)
