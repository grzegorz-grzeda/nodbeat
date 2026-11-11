# 0071: Open sign-up

Spec: 0017
Status: ready-for-agent

**What to build:** With `SIGNUP_OPEN=true`, anyone signs up with Google or GitHub, accepts the Terms and picks a time zone on one screen, and lands on Free with an empty Dashboard and a "Create your first Monitor" hint.

**Blocked by:** 0052, 0053, 0057, 0060, 0042, 0079 (signed-up Users have no password)

- [ ] `SIGNUP_OPEN` env var, default `false`; off → no sign-up buttons and `intent=signup` refused, Invites still work
- [ ] `intent=signup`: an unknown `(kind, subject)` with a verified email not used by any User creates a signed short-lived pending sign-up cookie and shows `/signup/finish`
- [ ] `/signup/finish`: time zone pre-filled from the browser and required Terms checkbox; `POST` creates the User on Free with acceptance recorded
- [ ] A provider account already connected → just logged in
- [ ] Verified email matching an existing User → "an account with this email exists; log in and connect it in Settings"
- [ ] 5 sign-ups per IP per hour on `POST /signup/finish` (`SlidingWindowLimiter`) → `429`, plus the login limiter on callbacks
- [ ] Empty Dashboard shows a "Create your first Monitor" hint
- [ ] Tests for each point with the fake provider
