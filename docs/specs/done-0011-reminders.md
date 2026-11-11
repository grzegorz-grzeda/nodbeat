# Spec 0011: Reminders

Status: resolved

Blocked by: spec 0009 (Alert channels)

## Problem Statement

A Down Alert is sent once per Incident. If I miss it — phone on silent, message buried in a busy group — a Monitor can stay Down for days without me noticing. Some Monitors (the backup, the freezer sensor) matter enough that I want to be told again.

## Solution

A Monitor can ask for **Reminders**: while it stays Down, nodbeat repeats the Down Alert every 1, 6 or 24 hours to the same Alert channels. Reminders stop when the Monitor comes back Up, is paused, or has its Alerts switched off. Off by default.

## User Stories

1. As a User, I want to choose "Remind me every 1 h / 6 h / 24 h while Down" or "Never" on a Monitor, so that important Monitors keep nagging and others don't.
2. As a User, I want a Reminder to say how long the Monitor has been Down and include the last Heartbeat message, so that I see it's the same Incident.
3. As a User, I want Reminders delivered like a Down Alert (loud on Telegram, high priority on ntfy, `kind: "reminder"` on Webhooks), so that they're noticed.
4. As a User, I want Reminders to stop when the Monitor comes back Up or I pause it, so that I'm not nagged about something resolved or deliberate.
5. As a User, I want Fail signals during a Down never to send extra Alerts or reset the Reminder timer, so that a job failing every 5 minutes doesn't spam me.
6. As a User, I want switching Reminders on for a Monitor already Down to start counting from now, so that I don't get a burst of catch-up Reminders.
7. As a User, I want the Incidents log to show how many Reminders an Incident sent, so that I know I was told.

## Implementation Decisions

- **Monitor field** `reminderEverySec: 3600 | 21600 | 86400 | null`, default `null`.
- **Incident fields** `nextReminderAt: Date | null`, `remindersSent: number`. Set to `downAt + reminderEverySec` when the Incident opens (or `now + reminderEverySec` when Reminders are switched on mid-Incident); cleared on Up, pause, or Alerts off; recomputed on setting change.
- **Sending**: the down-checker tick finds open Incidents with `nextReminderAt <= now`, enqueues an Alert of kind `reminder` (third `AlertKind`), and advances `nextReminderAt` by the cadence in the same update, so a slow tick never sends two. Missed ticks (process down) send one Reminder, not one per missed slot.
- **Outbox**: a pending Reminder for an Incident that closed is dropped like `dropPendingDownAlert` does for Down Alerts.
- **Fail signals** (spec 0007) don't touch `nextReminderAt`.

## Glossary Additions

Already in `GLOSSARY.md`: Reminder.

## Testing Decisions

- Single seam with the fake clock and fake senders.
- Scenarios: 1 h Reminders, Down at 10:00 → Reminders at 11:00 and 12:00, Up at 12:30 → none after; pause at 11:30 → none after; switched on at 11:20 while Down since 10:00 → first at 12:20; process "down" from 11:00 to 15:00 → one Reminder at 15:00; Fail signals every 5 min don't change timing; Webhook gets `kind: "reminder"`; Incidents log shows the count.

## Out of Scope

- Escalation to other channels or people after N Reminders.
- Acknowledging an Incident to silence Reminders (revisit if Users ask).
- Custom cadences.
