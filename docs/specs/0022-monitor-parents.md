# Spec 0022: Monitor Parents

Status: ready-for-agent

Blocked by: none (the Pro gate in issue 0087 waits for issue 0060)

## Problem Statement

A User watches several things on one home network: the router, a Raspberry Pi behind it, a NAS. All of them send Heartbeats over the same fibre line. When the line or the router goes down, every one of them goes silent at once, and the User gets one Down Alert per Monitor, then one Up Alert per Monitor. Only the first one is news; the rest follow from it.

nodbeat is push-only (ADR 0001), so it never sees "the router is down". It only sees Monitors miss their deadlines, each on its own Interval. A Pi on a 1 min Interval goes Down minutes before a router on a 5 min Interval, so "mute the Pi while the router is Down" alone would still let the Pi's Alert through first.

## Solution

A Monitor may have one **Parent**: the Monitor it depends on to reach nodbeat. It is then the Parent's **Child**.

- A Child that goes silent while its Parent is Down or Unreachable goes **Unreachable**, a new Monitor state: no Alerts, no Reminders, no Incident, left out of Uptime.
- A Child that goes silent while its Parent is silent too (no Parent Heartbeat since the Child's last one) is **held**: it stays Up until the Parent's own deadline. Parent goes Down → Child goes Unreachable. Parent sends a Heartbeat → Child goes Down with its normal Alert, late.
- When the Parent comes back Up, Unreachable Children get a fresh deadline. A Heartbeat in time brings them Up without an Up Alert; none brings them Down with a normal Down Alert.
- The Parent's Down Alert lists its Unreachable Children.

This is not a general rule engine: there are no AND/OR gates and no separate alarm/trigger objects (see Out of Scope).

## User Stories

1. As a User, I want to set a Monitor's Parent ("Depends on"), so that its Alerts follow from the Monitor it needs to reach nodbeat.
2. As a User whose home router or fibre line goes down, I want one Down Alert for the router, not one per device behind it.
3. As a User, I want a Child on a shorter Interval than its Parent not to alert first, so that the race between deadlines doesn't defeat the feature.
4. As a User, I want the router's Down Alert to name the devices behind it, so that I know what is affected.
5. As a User, I want devices behind the router to come back quietly when the router does, and to alert normally if one stays silent.
6. As a User, I want a device's Uptime not to suffer for an outage of the line it sits behind.
7. As a User, I want chains (fibre → router → Pi), so that a deeper network is covered.
8. As a User, I want a job's Fail signal to always alert at once, since it proves the device reached nodbeat.

## Implementation Decisions

- **Monitor field**: `parentId: ObjectId | null` (default `null`). The Parent must belong to the same User, may not be the Monitor itself, and may not create a cycle. Chains of any depth are allowed. Deleting a Monitor detaches its Children (`parentId = null`).
- **Form / API**: a "Depends on" select on the Monitor form listing the User's other Monitors (excluding ones that would make a cycle). The Monitor API reads and writes `parentId` with the same checks. `api/openapi.yaml` and the in-app API docs are updated; the change is additive.
- **Effective Parent**: a Parent counts only while it is Up, Down or Unreachable. A New or Paused Parent, or one on a User whose Plan has no Parents (issue 0087), is treated as no Parent. A Parent whose Alerts are switched off still counts: switching Alerts off doesn't change its state.
- **New state**: `MonitorState` gains `"unreachable"`. It is an uncounted state like New and Paused (`start-period` / `end-period`, left out of Uptime). No Incident is opened. Dashboard and Monitor page show "Unreachable — <Parent name> Down" (or "… Unreachable") with a link to the Parent. The Monitor page lists the Monitor's Children.
- **Deadline check of a Child** (Up, own deadline or Max run time passed), with P the effective Parent:
  - no P → as today (Down).
  - P is Down or Unreachable → Unreachable.
  - P is Up and has had a Heartbeat after the Child's last Heartbeat → Down (P is alive, so the Child really is down).
  - P is Up but silent since then → **held**: no transition now; check again at P's deadline (`nextDueAt` / `runDeadline` of P). Holding repeats up the chain.
  - Holding is not stored as a state; the down checker derives it each pass. A held Child shows as Up ("late").
- **Parent transitions** re-check its Children in the same pass, before Alerts are delivered:
  - P goes Down or Unreachable → held Children go Unreachable (and their held Children too).
  - P comes back Up, or stops counting (Paused, deleted, detached, Plan lost) → each Unreachable Child gets a fresh deadline from now (Interval or next scheduled time + Grace period), as after an unpause. A Heartbeat in time → Up without an Up Alert; otherwise → Down with an Incident and a normal Down Alert (and Reminders).
- **Heartbeat on an Unreachable Child** (e.g. its Parent is still late): → Up, no Up Alert. Change Alerts work as usual.
- **Fail signal on a Child** is never held or suppressed: Down at once with its Alert, whatever the Parent is doing.
- **Pause / unpause / edit** of an Unreachable Child behaves as for Down without an Incident: pause ends the unreachable period; unpause gives New as today.
- **Parent Down Alert**: Telegram, ntfy and Webhook Down Alerts of a Monitor with Children list the Children that are Unreachable when it is sent ("Also unreachable: Pi, NAS"). Webhook gets `unreachableChildren: [{ id, name }]` (empty for other kinds and Monitors). The Up Alert lists nothing.
- **Plans**: Parents are Pro-only (issue 0087). After a downgrade the `parentId` is kept but ignored ("Depends on needs Pro") and works again on upgrade. With Plans off (self-hosted), always available.
- **Docs**: in-app API docs, landing feature list, CHANGELOG (minor version bump).

## Testing Decisions

- Unit-test the pure state machine for the new `unreachable` state and its events (to Unreachable, Heartbeat → Up without Alert, fresh deadline → Down with Incident, pause, Fail signal).
- Unit-test the decision function for a Child's deadline check over every Parent case above, including chains and the held case.
- Seam tests (`buildTestApp`, fake clock): router 5 min + Pi 1 min, both silent → exactly one Down Alert (router, listing Pi), Pi Unreachable, no Pi Uptime loss; router back + Pi back → one Up Alert (router); router back, Pi silent → Pi Down Alert after its Interval + Grace; router alive, Pi silent → Pi Down Alert at the router's deadline; Pi Fail signal while router silent → immediate Alert; cycle and cross-User Parent refused by form and API.

## Out of Scope

- A general rule engine: separate alarm and trigger objects, AND/OR/NOT gates, conditions over messages.
- More than one Parent per Monitor.
- A tree view of the Dashboard.
- Grouping several Children's Down Alerts into one digest without a Parent.
- Active probes of the Parent (ADR 0001 stays).
