# Spec 0021: Change Alerts

Status: resolved

Blocked by: none

## Problem Statement

Many devices put their state into the Heartbeat message: `door=open`, `fw=1.4.2`, `ip=10.0.0.7`. Today a User sees that message only on the Dashboard or in the log. When it changes, nothing tells them, even though the change is often exactly what they care about.

## Solution

Add a per-Monitor option, off by default, that sends a **Change Alert** when a Heartbeat's message differs from the message of the last Heartbeat before it that had one. It goes to the Monitor's Alert channels like any other Alert. It never touches Monitor state.

## User Stories

1. As a User, I want to switch on Change Alerts for a Monitor, so that I hear when its device reports a new state.
2. As a User, I want the Change Alert to show the old and the new message, so that I see what changed without opening nodbeat.
3. As a User, I want Heartbeats without a message ignored, so that a device that sometimes sends a bare Heartbeat doesn't cause false Alerts.
4. As a User, I want no Change Alert for the first message, or for a change I already lived through while the Monitor was Paused or its Alerts were off, so that I only get news.
5. As a Webhook user, I want a distinct `change` event carrying both messages, so that my automation can react to it.

## Implementation Decisions

- **What counts**: only plain Heartbeats (`kind: "success"`). Fail and Start signals neither trigger a Change Alert nor change the baseline.
- **Compare**: an exact compare of the stored message, which is already trimmed and capped at 200 characters. There's no case-folding, pattern or threshold matching.
- **Baseline**: a new Monitor field, e.g. `changeBaseline: string | null`, holding the last non-empty plain Heartbeat message. It can't reuse `lastMessage`, because Fail signals and bare Heartbeats overwrite that. The baseline updates on every Heartbeat with a message, whether the option is on or off, and whatever the state, Paused included. A missing or `null` baseline (a new Monitor, or one from before this spec) means "first message": set it and send nothing. When a Monitor is created, the baseline is `null`.
  - Turning the option on therefore compares against the latest message seen. That fulfils story 4 for anything known before the toggle, and nothing is sent at the moment of the toggle itself.
- **Monitor setting**: `changeAlerts: boolean` (default `false`), on the Monitor form next to Reminders, with the hint "Alert when the Heartbeat message changes". It's available on every Plan.
- **State machine**: the `heartbeat` event emits `{ kind: "enqueue-alert", alert: "change" }` when the option is on, Alerts are enabled, the Monitor isn't Paused, the baseline is non-null, and the message is non-empty and differs from the baseline. The event also carries the previous message for the Alert. Monitor state, Incidents, periods and Uptime are unchanged.
- **Ordering**: when the same Heartbeat brings the Monitor Up, the effects are the Up Alert first and then the Change Alert.
- **Alert kind**: `AlertKind` gains `"change"`, with traits `aboutDown: false`, `loud: false`, emoji 🔄, ntfy priority `3` and tag `arrows_counterclockwise`. It is never dropped when the Monitor goes Up and never repeated as a Reminder. Pausing, or switching Alerts off, drops pending ones as it does other pending Alerts.
- **Text**: the title is `<Monitor name> has a new message` and the summary is `<old> → <new>` plus the time. Telegram and ntfy use these as for other kinds.
- **Webhook**: `kind: "change"`, `message` holds the new message, a new `previousMessage` field (null for other kinds) and `incidentId: null`. Update `api/openapi.yaml`, where `incidentId` becomes nullable; the change is additive and documented.
- **Docs**: the in-app API docs, the landing feature list and CHANGELOG (minor version bump).

## Testing Decisions

- Unit-test the state machine: first message, no message, the same message, a different message, Fail signal messages ignored, Paused/Alerts-off updating the baseline silently, and Up + change ordering.
- Seam tests (`buildTestApp`, `Browser`): toggle on → Heartbeats `a`, `a`, (none), `b` give exactly one Change Alert `a → b` on Telegram, ntfy and a Webhook (body fields and signature); toggle off → none; Pause during the change → none after unpause.

## Out of Scope

- Pattern, regex, JSON-key or numeric-threshold matching.
- Comparing against a fixed expected value.
- A cooldown or flapping protection.
- Separate Alert channels for Change Alerts.
- Marking changed messages in the Heartbeat log.
