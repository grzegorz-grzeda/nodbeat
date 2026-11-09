# 0013: Landing page

Spec: 0002
Status: ready-for-agent

**What to build:** A visitor who isn't logged in sees a landing page at `/` that explains nodbeat. A logged-in User still sees the Dashboard there.

**Blocked by:** 0011.

- [ ] `GET /` without a session renders the landing page instead of redirecting to `/login`
- [ ] Hero with the tagline "A heartbeat for every service and device"
- [ ] How it works in 3 steps: create a Monitor → send Heartbeats to its URL (`curl` example) → get a Telegram Alert when it goes silent and when it's back
- [ ] Feature list; single "Log in" button, no sign-up
- [ ] Follows the OS theme; works on a phone
- [ ] Tests: `/` without a session is 200 with "Log in"; with a session it's the Dashboard
