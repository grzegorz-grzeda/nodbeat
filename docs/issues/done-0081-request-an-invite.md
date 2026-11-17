# 0081: Request an Invite

Spec: 0020
Status: resolved

**What to build:** With `INVITE_REQUESTS=true`, a visitor requests an Invite from the landing page; the Admin sees it on the Invites page and creates an Invite for it or dismisses it.

**Blocked by:** None (can start immediately)

- [x] Form with email, note and a honeypot; the same thank-you whatever the outcome
- [x] One request per email, no IP stored, expires after 30 days, deleted once handled
- [x] 3 per IP per hour → 429; 200 pending → 503
- [x] Admin list, Create Invite (with a `mailto:`), Dismiss; the pending count on `/admin`
- [x] Off by default; `docs/deploy.md` documents the variable and the privacy policy note
