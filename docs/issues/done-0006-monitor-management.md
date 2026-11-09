# 0006: Monitor management

Spec: 0001
Status: ready-for-agent

**What to build:** I can edit a Monitor, regenerate its Heartbeat URL, pause and unpause it, turn its Alerts on or off, and delete it.

**Blocked by:** 0004.

- [x] Edit name, Interval, Grace period and notes, within the limits; the deadline is recalculated after an edit
- [x] Regenerating the Heartbeat URL makes the old one return 404
- [x] Pause → Paused state: never goes Down; Heartbeats are still accepted (200) and recorded
- [x] Pausing a Down Monitor closes its open Incident (end reason: paused)
- [x] Unpause gives a fresh Interval + Grace period from that moment; the Monitor resumes as Up if a Heartbeat arrived during the pause, otherwise New
- [x] Pause periods are recorded for the Uptime calculation
- [x] Alerts on/off switch is stored on the Monitor (enforced in 0007)
- [x] Delete, after a confirmation, removes the Monitor with its Heartbeats and Incidents
