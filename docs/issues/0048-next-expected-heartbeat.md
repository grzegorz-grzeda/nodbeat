# 0048: Next expected Heartbeat

Spec: 0010
Status: ready-for-agent

**What to build:** The Monitor page and Dashboard show "next expected by HH:MM" for every Monitor that is Up or New. One rule decides when a Monitor is next due, and both this display and Down detection use it, so a Schedule can later be added in one place.

**Blocked by:** none.

- [ ] One rule gives a Monitor's due time (last Heartbeat, creation or unpause + Interval + Grace period); Down detection uses it, with behaviour unchanged
- [ ] Monitor page and Dashboard show "next expected by" in the User's time zone; nothing for Paused or Down Monitors
- [ ] The live Dashboard update includes it
- [ ] Tests through the HTTP seam: the shown time matches the minute the Monitor goes Down; New, Up, Paused and Down Monitors display correctly
