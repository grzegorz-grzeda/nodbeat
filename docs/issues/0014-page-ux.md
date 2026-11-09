# 0014: Page-by-page UX

Spec: 0002
Status: ready-for-agent

**What to build:** The Dashboard and Monitor pages give clear feedback and make common tasks quick.

**Blocked by:** 0011.

- [ ] Dashboard rows/cards: state badge, relative last Heartbeat time (exact on hover), last message, 7-day Uptime; live updates keep working
- [ ] Empty state with "Create your first Monitor"
- [ ] Flash message after save, pause, unpause, regenerate, delete and unlink (signed cookie, shown once)
- [ ] Copy button for the Heartbeat URL and copyable `curl` GET/POST examples
- [ ] Confirmation before delete, regenerate and unlink
- [ ] Mobile layout for every page
- [ ] Tests: a flash message shows once after an action and is gone on the next load
