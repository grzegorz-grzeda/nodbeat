# Spec 0010: Schedules

Status: ready-for-agent

Blocked by: spec 0007 (Start and Fail signals), so a scheduled job can use both

## Problem Statement

Most of what I watch runs at fixed times: a backup at 02:00, a report on weekdays at 08:00. An Interval only fits jobs that run evenly. A daily job with a 24 h Interval drifts with every late run, and a weekday job can't be watched at all without a false Down every Saturday.

## Solution

A Monitor has either an **Interval** or a **Schedule**. A Schedule is a 5-field cron expression read in the Monitor's own time zone (default: the owner's). A scheduled Monitor is Down when no Heartbeat arrived between the previous scheduled time and the current scheduled time + Grace period. Every Monitor shows when its next Heartbeat is expected.

## User Stories

1. As a User, I want to give a Monitor a Schedule like `0 2 * * *` instead of an Interval, so that a nightly job is watched at the right time.
2. As a User, I want a Schedule read in a time zone I choose per Monitor, defaulting to mine, so that a server in UTC and DST changes work.
3. As a User, I want the form to show the next three scheduled times as I type, so that I know my expression means what I think.
4. As a User, I want an invalid expression rejected with a clear error, so that I don't save a Monitor that never fires.
5. As a User, I want a scheduled Monitor to go Down when the Heartbeat for a scheduled time hasn't arrived by that time + Grace period, so that a missed run alerts me.
6. As a User, I want a weekday-only job to stay Up over the weekend, so that I get no false Alerts.
7. As a User, I want a Heartbeat that arrives early (before the scheduled time but after the previous one) to count for the coming run, so that a job that starts at 01:58 is fine.
8. As a User, I want the Monitor page and Dashboard to show "next expected by HH:MM" for every Monitor, Interval or Schedule, so that I know when it would go Down.
9. As a User, I want to switch a Monitor between Interval and Schedule in the edit form, so that I don't have to recreate it and lose its history.
10. As a User, I want the Monitor page cron example to use my Schedule, so that I paste a matching crontab line.

## Implementation Decisions

- **Monitor fields**: `intervalSec` becomes optional; new `schedule: { cron: string; timeZone: string } | null`. Exactly one of `intervalSec` and `schedule` is set; existing Monitors keep `intervalSec`.
- **Cron**: standard 5 fields, ranges, lists, steps, names (`MON`, `JAN`), no seconds, no `@reboot`. Parsed with a small, well-tested dependency (e.g. `cron-parser`) — reviewed in the dependency audit (issue 0026).
- **Down rule**: the down-checker computes `dueAt` = the first scheduled time after the last Heartbeat (or after creation/unpause for New) + Grace period; Down when `now > dueAt`. Interval Monitors keep `lastHeartbeat + intervalSec + graceSec`. Both go through one `nextDueAt(monitor)` function, used by the checker and the "next expected" display.
- **Minimum gap**: a Schedule whose closest two times are closer than the Interval limit in `limitsFor` is rejected, so a Schedule can't beat the Heartbeat rate limit.
- **Grace period default** for a Schedule: based on the shortest gap between scheduled times, using the existing `defaultGraceSec`.
- **Admin page**: the Monitor setup breakdown counts Schedule Monitors as their own group.
- **API docs**: unchanged (Heartbeat routes don't change).

## Glossary Additions

Already in `GLOSSARY.md`: Schedule; Interval and Grace period updated.

## Testing Decisions

- Single seam with the fake clock.
- Scenarios: `0 2 * * *` Monitor gets a Heartbeat at 02:01 → Up; none by 02:00 + Grace → Down at the right minute; `0 8 * * 1-5` stays Up from Friday 08:05 to Monday 08:00 + Grace; Monitor in `Europe/Warsaw` across the March and October DST changes fires once per day; early Heartbeat at 01:58 counts; invalid expression and `* * * * *` (below minimum gap) rejected; switching Interval → Schedule keeps Incidents and Uptime; "next expected by" matches the down-checker.

## Out of Scope

- Seconds or years in expressions, `@reboot`, `L`/`W`/`#` extensions.
- Several Schedules per Monitor.
- Pausing on a schedule (maintenance windows).
