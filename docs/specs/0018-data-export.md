# Spec 0018: Download my data

Status: ready-for-agent

Blocked by: none

## Problem Statement

GDPR gives every User the right to a copy of their data (Art. 15) in a machine-readable form they can take elsewhere (Art. 20). Today the only way is for the Admin to dig through the database by hand, which doesn't scale once strangers sign up (spec 0017), and Users who want to leave or move to another tool have nothing to take with them.

## Solution

"Download my data" in Settings gives the User one JSON file with everything nodbeat holds about them, built on request. Alert channel secrets are left out. It pairs with account deletion (spec 0012): export, then delete.

## User Stories

1. As a User, I want a "Download my data" button in Settings, so that I can get a copy of my data without asking anyone.
2. As a User, I want the file to hold my account (email, time zone, Login methods, accepted Terms versions, Plan), my Monitors with their settings and Heartbeat URLs, their Incidents and Heartbeats as far back as my Plan keeps them, and my Alert channels, so that it's complete.
3. As a User, I want Alert channel secrets (Webhook secrets, ntfy tokens) left out, so that a leaked export can't be used to forge Alerts.
4. As a User, I want the file to be plain JSON with ISO dates and a `version` field, so that I can read it or import it elsewhere.
5. As the Operator, I want at most one export per User per hour, so that it can't be used to load the database.

## Implementation Decisions

- **Route**: `POST /settings/export` (CSRF) streams `nodbeat-export-<date>.json` with `Content-Disposition: attachment`. Built synchronously from the database; no background job or stored file.
- **Shape**: `{ version: 1, exportedAt, user, monitors: [{ ...settings, heartbeatUrl, incidents, heartbeats }], alertChannels }`. Internal ids are kept so the parts reference each other; password hash, session ids, Stripe ids and channel secrets are left out (a `secretSet: true` flag instead).
- **Fields from later specs**: Login methods, accepted Terms versions and Plan are exported when those specs have shipped; whichever of this spec and specs 0013–0016 lands later adds its User data to the export.
- **Limit**: `SlidingWindowLimiter`, 1 per User per hour → `429` with a Flash message saying when it's possible again.
- **Size**: Pro at 100 Monitors × 1000 Heartbeats is ~100k rows; streamed as a cursor per Monitor, never all in memory.
- **Privacy policy**: names the export as how to exercise access and portability (spec 0014).

## Testing Decisions

- Single seam as usual. Scenarios: export holds the User, Monitors, Incidents, Heartbeats and Alert channels; no secret, password hash or session id appears anywhere in the file; second export within an hour → `429`, after an hour → works; another User's data never appears; a User with no Monitors gets a valid file.

## Out of Scope

- Importing an export.
- CSV or other formats.
- Admin exporting another User's data.
