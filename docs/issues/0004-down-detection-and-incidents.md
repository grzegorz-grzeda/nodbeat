# 0004: Down detection and Incidents

Spec: 0001
Status: ready-for-agent

**What to build:** When a Monitor stops sending Heartbeats it goes Down within about 10 s of Interval + Grace period, and an Incident opens. The next Heartbeat brings it back Up and closes the Incident. The Monitor page shows the Incident history and the last 7 days of Heartbeats.

**Blocked by:** 0003.

- [ ] `app.tick()` moves Up Monitors past their deadline to Down; production calls it every 10 s
- [ ] New Monitors never go Down
- [ ] Startup grace: after nodbeat starts, no Monitor goes Down before startup time + Interval + Grace period (test: a new `createApp` on the same DB with the clock moved ahead)
- [ ] Going Down opens an Incident; a Heartbeat on a Down Monitor closes it (end reason: heartbeat) and moves it to Up
- [ ] The Monitor page lists Incidents (start, end, duration) and the last 7 days of Heartbeats with their messages
- [ ] Scenario test: create 60 s / 30 s, Heartbeat, advance 91 s, tick → Down; Heartbeat → Up, Incident closed
