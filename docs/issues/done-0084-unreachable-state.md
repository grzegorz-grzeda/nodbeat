# 0084: Unreachable Children

Spec: 0022
Status: resolved

**What to build:** A Child that misses its deadline while its Parent is Down or Unreachable goes Unreachable: no Alert, Reminder or Incident, left out of Uptime. When the Parent comes back Up, the Child gets a fresh deadline and comes back quietly or goes Down normally.

**Blocked by:** 0083

- [x] `MonitorState` gains `"unreachable"`, an uncounted state (periods, Uptime) like New and Paused
- [x] Effective Parent: counts only while Up, Down or Unreachable; New/Paused Parent = no Parent; Alerts-off Parent still counts
- [x] Deadline check: Parent Down/Unreachable → Child Unreachable (also via chains); otherwise Down as today. Chain walks stop at a Monitor already seen (a cycle can slip in through simultaneous edits)
- [x] Heartbeat on Unreachable Child → Up, no Up Alert
- [x] Parent back Up, or stops counting (Paused, deleted, detached) → Unreachable Children get a fresh deadline (Interval or next scheduled time + Grace); missed → Down with Incident, Alert and Reminders
- [x] Pause/unpause/edit of an Unreachable Child; Fail signal → Down at once
- [x] Dashboard and Monitor page: "Unreachable — <Parent> Down" linking to the Parent (no API or Webhook field carries a Monitor state, so nothing to change there)
- [x] Unit tests (state machine, Child decision) and seam tests with a fake clock

## Comments

- Release is derived by the down checker, not hooked into Parent routes: when an Unreachable Child's Parent isn't Down or Unreachable any more (Up, New, Paused, deleted, detached), the next pass sets `parentUpAt` and its fresh deadline counts from then. The same will cover losing Pro (issue 0087).
- Each pass handles Parents before their Children (`parentsFirst`), so a Child sees the Parent's state from the same pass.
- Until issue 0085 lands, a Child whose own deadline passes before its Parent's still goes Down with an Alert.
