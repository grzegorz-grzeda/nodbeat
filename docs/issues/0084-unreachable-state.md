# 0084: Unreachable Children

Spec: 0022
Status: ready-for-agent

**What to build:** A Child that misses its deadline while its Parent is Down or Unreachable goes Unreachable: no Alert, Reminder or Incident, left out of Uptime. When the Parent comes back Up, the Child gets a fresh deadline and comes back quietly or goes Down normally.

**Blocked by:** 0083

- [ ] `MonitorState` gains `"unreachable"`, an uncounted state (periods, Uptime) like New and Paused
- [ ] Effective Parent: counts only while Up, Down or Unreachable; New/Paused Parent = no Parent; Alerts-off Parent still counts
- [ ] Deadline check: Parent Down/Unreachable → Child Unreachable (also via chains); otherwise Down as today. Chain walks stop at a Monitor already seen (a cycle can slip in through simultaneous edits)
- [ ] Heartbeat on Unreachable Child → Up, no Up Alert
- [ ] Parent back Up, or stops counting (Paused, deleted, detached) → Unreachable Children get a fresh deadline (Interval or next scheduled time + Grace); missed → Down with Incident, Alert and Reminders
- [ ] Pause/unpause/edit of an Unreachable Child; Fail signal → Down at once
- [ ] Dashboard and Monitor page: "Unreachable — <Parent> Down" linking to the Parent; API/Webhook state enums and `api/openapi.yaml` updated
- [ ] Unit tests (state machine, Child decision) and seam tests with a fake clock
