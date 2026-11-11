# 0049: Schedule Monitors

Spec: 0010
Status: ready-for-agent

**What to build:** A User gives a Monitor a Schedule (5-field cron expression in a time zone chosen per Monitor) instead of an Interval. It goes Down when the Heartbeat for a scheduled time hasn't arrived by that time + Grace period, and stays Up between runs, so a weekday job is quiet at the weekend.

**Blocked by:** 0048.

- [ ] Create and edit forms: Interval or Schedule; cron field and time zone (default: the owner's); the next three scheduled times are shown as the User types
- [ ] Invalid expressions and Schedules whose closest two times are closer than the Interval limit are rejected with a clear error
- [ ] Due time for a Schedule = first scheduled time after the last Heartbeat (or creation/unpause) + Grace period; default Grace period based on the shortest gap
- [ ] Switching between Interval and Schedule keeps Incidents, logs and Uptime
- [ ] Monitor page cron example uses the Schedule; the Admin Monitor setup breakdown counts Schedule Monitors as their own group
- [ ] Tests through the HTTP seam with the fake clock: `0 2 * * *` Up at 02:01, Down at 02:00 + Grace; `0 8 * * 1-5` stays Up over the weekend; `Europe/Warsaw` across both DST changes fires once per day; a Heartbeat at 01:58 counts; invalid and too-frequent expressions rejected; switching keeps history
