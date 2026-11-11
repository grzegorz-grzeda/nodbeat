# 0051: Connect Google and log in with it

Spec: 0013
Status: ready-for-agent

**What to build:** A logged-in User connects their Google account in Settings, and from then on can log in with "Log in with Google" on the login page. This lays the OAuth groundwork (authorization code + PKCE + `state` by hand with `fetch`, a fake OAuth provider injected in tests, optional `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `users.logins` keyed by provider subject) that later tickets reuse.

**Blocked by:** None (can start immediately).

- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` optional; without both, no Google buttons anywhere and password login works as today
- [ ] Settings → "Connect Google" runs the flow with `intent=link` and adds a Login method `{ kind, subject, email, linkedAt }`; unique index on `(logins.kind, logins.subject)`, a Google account already connected to another User is refused
- [ ] "Log in with Google" looks up by `(kind, subject)` only and logs the User in; no match → "No nodbeat account for this Google account"
- [ ] A Google login whose email matches an existing User that hasn't connected it is refused with "connect it in Settings first"; never auto-linked
- [ ] Only `email_verified` Google emails are accepted
- [ ] `state` mismatch or missing PKCE cookie → refused with a Flash message on the login page
- [ ] Callbacks share the per-IP login limiter; the User's `email` is never overwritten by later logins
- [ ] Tests through the HTTP seam with the fake provider and fake clock cover every point above
