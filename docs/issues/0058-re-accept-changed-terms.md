# 0058: Re-accept changed Terms

Spec: 0014
Status: ready-for-agent

**What to build:** When the Terms or Privacy policy version changes, a User is sent to `/accept-terms` on their next page load, sees the "what changed" summary, accepts once, and goes back where they were. Existing Users get this prompt on first login after it ships.

**Blocked by:** 0057

- [ ] A hook after `requireUser` redirects HTML pages to `/accept-terms` when a stored version is older than the current one, or missing
- [ ] Heartbeat URLs, API, Telegram webhook and Alerts are never blocked
- [ ] Accepting records the new versions and returns to the original page
- [ ] Tests: bump the version → next page load redirects, Heartbeats still `200`; accept → back to the page
