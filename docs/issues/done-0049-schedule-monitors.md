# 0049: Schedule Monitors

Spec: 0010
Status: resolved

**What to build:** A User gives a Monitor a Schedule (5-field cron expression in a time zone chosen per Monitor) instead of an Interval. It goes Down when the Heartbeat for a scheduled time hasn't arrived by that time + Grace period, and stays Up between runs, so a weekday job is quiet at the weekend.

**Blocked by:** 0048, 0038 (spec 0010 is blocked by spec 0007; the cron example combines Start/Fail with the Schedule).

- [ ] Cron parsing via a small, well-tested dependency (e.g. `cron-parser`); passes the CI dependency audit (issue 0026); 5 fields, ranges, lists, steps, names; no seconds, `@reboot`, `L`/`W`/`#`
- [ ] Monitor stores `schedule: { cron, timeZone } | null`; exactly one of `intervalSec` and `schedule` is set; existing Monitors keep `intervalSec`
- [ ] Create and edit forms: Interval or Schedule; cron field and time zone (default: the owner's); the next three scheduled times are shown as the User types
- [ ] Invalid expressions and Schedules whose closest two times are closer than the Interval limit are rejected with a clear error
- [ ] Due time for a Schedule = first scheduled time after the last Heartbeat (or creation/unpause) + Grace period; default Grace period based on the shortest gap
- [ ] Switching between Interval and Schedule keeps Incidents, logs and Uptime
- [ ] "Next expected by" (issue 0048) works for Schedule Monitors
- [ ] Monitor page cron example uses the Schedule (keeping Start/Fail from issue 0038); the Admin Monitor setup breakdown counts Schedule Monitors as their own group
- [ ] Tests through the HTTP seam with the fake clock: `0 2 * * *` Up at 02:01, Down at 02:00 + Grace; `0 8 * * 1-5` stays Up over the weekend; `Europe/Warsaw` across both DST changes fires once per day; a Heartbeat at 01:58 counts; invalid and too-frequent expressions rejected; switching keeps history; "next expected by" matches the minute the down-checker marks it Down
