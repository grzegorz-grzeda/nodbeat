# Spec 0006: Admin usage page

Status: needs-triage

## Problem Statement

I don't know how nodbeat is actually used, so I can't tell which features to build next. Being the **Admin** changes nothing in the web UI: `isAdmin` is set by the CLI and read nowhere else. To answer "how many Monitors send messages?" or "what are devices calling the Heartbeat URL with?" I have to write queries in Atlas by hand. Once beta Users join (spec 0008), I'll need this even more, and I'll need a way for them to tell me what's missing.

## Solution

An Admin-only page at `/admin` with numbers for the whole instance: totals, how Monitors are set up and how Heartbeats arrive. It shows counts and shares only, never Monitor names, notes, Heartbeat messages or IPs. Heartbeats start recording a short User-Agent so the page can show which clients send them. Every page gets a "Feedback" link in its footer.

## User Stories

1. As the Admin, I want an "Admin" link in the nav, so that I can reach the usage page in one click.
2. As a User who isn't the Admin, I want `/admin` to answer 404, so that the page doesn't exist for me.
3. As the Admin, I want totals for Users, Monitors (by Monitor state), Linked chats and Heartbeats in the last 7 days, so that I see how big the instance is.
4. As the Admin, I want the number of Incidents opened in the last 7 and 30 days, so that I see how often things fail.
5. As the Admin, I want Monitors grouped by Interval (≤ 1 min, ≤ 5 min, ≤ 1 h, ≤ 1 day, > 1 day), so that I know what kinds of things are watched.
6. As the Admin, I want the share of Monitors with a custom Grace period, with notes, with Alerts off and Paused, so that I see which settings matter.
7. As the Admin, I want the share of last-7-day Heartbeats sent with GET vs POST and with a message, so that I know how devices talk to nodbeat.
8. As the Admin, I want last-7-day Heartbeats grouped by client (curl, wget, Python, ESP32/Arduino, browser, other, none), so that I know which snippets and libraries are worth writing.
9. As the Admin, I want one row per User with their Monitor count, Linked chat count, Heartbeats in the last 7 days and the time of their last Heartbeat, so that I see who is actually using it.
10. As a User, I want the Admin page never to show my Monitor names, notes, messages or IPs, so that the Admin sees how I use nodbeat, not what I watch.
11. As a User, I want a "Feedback" link in the footer, so that I can tell the Admin what's missing.

## Implementation Decisions

- **Admin guard**: a `requireAdmin` preHandler next to `requireUser` in `src/auth.ts`. A logged-in non-Admin and a visitor both get the 404 error page (a visitor isn't sent to the login page, so the URL doesn't hint that something is there). Spec 0008 reuses the guard.
- **Nav**: the "Admin" link is rendered only for an Admin.
- **Numbers are computed on each request** with aggregations over the existing collections. No counters or new collections. "Last 7 days" matches what the Heartbeat TTL index keeps.
- **User-Agent**: the Heartbeat doc gets `userAgent: string | null`, the `User-Agent` header trimmed to 200 characters. Heartbeats stored before this have none and count as "none". The client groups come from simple substring rules in one function (`curl/`, `Wget/`, `python-requests` / `aiohttp` / `urllib`, `ESP32HTTPClient` / `arduino` / `esp-idf`, `Mozilla/`); the raw strings are not shown.
- **Interval groups and shares** are computed from `monitors`. "Custom Grace period" means it differs from the default (half the Interval, clamped to the Grace bounds in `src/limits.ts`).
- **Per-User table**: email, counts and the last Heartbeat time in the Admin's time zone. Sorted by last Heartbeat, newest first.
- **Feedback link**: points at the GitHub repository's issues page (`https://github.com/grzegorz-grzeda/nodbeat/issues`), next to the existing version link in the footer. No form, nothing stored.
- **Page**: plain server-rendered tables in the existing app shell; no charts.

## Glossary Additions

None. "Admin" already exists; the page is not a domain concept.

## Testing Decisions

- Same single seam: `createApp`, Fastify `inject`, the fake clock, real Mongo in memory.
- A non-Admin and a visitor get 404 from `/admin`; the nav shows "Admin" only to an Admin.
- Scenario: two Users with Monitors of different Intervals, some Paused or with Alerts off, Heartbeats sent with GET/POST, with and without messages and with `curl/8.5.0` and `ESP32HTTPClient` User-Agents → the page shows the expected counts and groups.
- A Monitor name, note and Heartbeat message seeded with a unique marker never appear in the page.
- Heartbeats older than 7 days (moved past with the fake clock) are not counted.

## Out of Scope

- Charts, history over time and CSV export.
- Managing Users from the web (creating, deleting, making Admin); invites are spec 0008.
- Telemetry sent anywhere outside the instance.
- Storing or showing IPs or raw User-Agent strings.
