# Spec 0012: Account deletion

Status: ready-for-agent

Blocked by: spec 0008 (Invite links)

## Problem Statement

Once Invites ship, people I don't know well get accounts. A User who stops using nodbeat can't leave: their Monitors keep going Down, Alerts keep going to their chats, and their data stays on Atlas until I delete it by hand in the database. For an EU-hosted service holding emails, that's not good enough.

## Solution

A User deletes their own account from Settings by confirming their password. Everything they own goes with it: Monitors, Heartbeats, Incidents, state periods, queued Alerts, Alert channels, Link codes and sessions. The Admin can't delete their own account, so the instance always has one.

## User Stories

1. As a User, I want a "Delete account" button in Settings, so that I can leave nodbeat without asking the Admin.
2. As a User, I want to confirm deletion with my password on a page that says what will be deleted, so that a stolen cookie or a misclick can't delete my account.
3. As a User, I want all my Monitors, Heartbeats, Incidents, Alert channels and sessions deleted, so that nothing of mine stays behind.
4. As a User, I want to land on the landing page with a "Your account was deleted" message, so that I know it worked.
5. As a User, I want my Heartbeat URLs to stop working at once, so that my devices get `404` instead of feeding a dead account.
6. As the Admin, I want my own account to have no delete button, so that I can't lock myself out of the instance.
7. As the Admin, I want an Invite used by a deleted User to show "used by (deleted User)", so that the Invite history stays honest.
8. As the Admin, I want the Admin page totals to drop the deleted User's data, so that usage numbers stay true.
9. As a Pro User, I want deleting my account to cancel my subscription at once, so that I'm never charged for an account that no longer exists.

## Implementation Decisions

- **Routes**: `GET /settings/delete-account` (confirmation page listing counts: Monitors, Alert channels) and `POST /settings/delete-account` (password + CSRF). Wrong password → page again with an error, counted towards the login limit (issue 0020).
- **Order of deletion**: sessions first (so the User is logged out even if a later step fails), then queued Alerts, Monitors and their logs/periods/Incidents, Linked chats, Link codes, then the User. Each step is idempotent, so a retry after a crash finishes the job. A User document gets `deletingAt` before the first step; login refuses a User with `deletingAt`, and the startup sweep finishes any half-done deletion.
- **Linked chats shared by two Users**: only the deleting User's link is removed; the chat keeps getting the other User's Alerts.
- **Pro Users** (once spec 0016 ships; issue 0070): the Stripe subscription is cancelled at once, before any data is deleted, with no refund for the rest of the period. The confirmation page says so. The Stripe customer itself stays in Stripe as long as tax records require; nodbeat keeps no copy of it.
- **Login methods** (once spec 0013 ships; issue 0079): Google and GitHub links are deleted with the User, so the same Google/GitHub account can sign up again later. A User without a password confirms deletion by logging in again with Google/GitHub instead of typing a password.
- **Invites**: `usedBy` stays as a dangling id; the Invite list shows "(deleted User)" when the id resolves to nothing.
- **Admin guard**: the button and both routes are absent for `isAdmin` Users (`404`).
- **Reuse**: Monitor deletion reuses the existing per-Monitor delete path (`deleteAlertsOf`, logs, periods) in a loop.

## Testing Decisions

- Single seam: `createApp`, Fastify `inject`, fake clock, in-memory Mongo.
- Scenarios: User with two Monitors, a Linked chat and two sessions deletes the account → both sessions get `401`/redirect, Heartbeat URLs `404`, no documents with their id remain in any collection; wrong password → nothing deleted; Admin → `404`; a chat linked by two Users still alerts the other one; an Invite used by the deleted User shows "(deleted User)"; a deletion interrupted after the sessions step is finished on the next start.

## Out of Scope

- Data export (spec 0018).
- The Admin deleting or disabling other Users.
- A grace period or undo.
