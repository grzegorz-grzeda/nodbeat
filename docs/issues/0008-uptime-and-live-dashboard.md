# 0008: Uptime and live Dashboard

Spec: 0001
Status: ready-for-agent

**What to build:** The Dashboard shows the 7-day Uptime for each Monitor and refreshes about every 5 s without a page reload. I can set my time zone on the Settings page.

**Blocked by:** 0006.

- [ ] Uptime = time Up ÷ (time Up + time Down) over the window; New and Paused time is left out; "—" when there is no Up or Down time
- [ ] A Dashboard JSON endpoint returns the User's Monitors with state, last Heartbeat time, last message and 7-day Uptime
- [ ] A small client-side script polls it about every 5 s and updates the Dashboard
- [ ] Settings page lets me change my time zone; displayed times use it
- [ ] Tests: Uptime with and without Paused time, a fully Paused window gives "—", ownership isolation on the JSON endpoint
