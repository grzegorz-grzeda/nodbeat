# 0002: Users and login

Spec: 0001
Status: ready-for-agent

**What to build:** I can create my User (with the Admin flag) from the CLI, log in with my email and password, see an empty Dashboard, and log out. Unauthenticated visitors are sent to the login page.

**Blocked by:** 0001.

- [ ] CLI command creates a User with email, password, Admin flag and time zone (default Europe/Warsaw); the email is unique
- [ ] Passwords are hashed with argon2id
- [ ] Login and logout; sessions are stored in Mongo with a 30-day sliding expiry; the cookie is HttpOnly, Secure and SameSite=Lax
- [ ] Login is limited to 5 attempts per 15 minutes per IP, after which it is rejected
- [ ] Every state-changing form is CSRF-protected
- [ ] The Dashboard requires login and shows an empty state
- [ ] Tests through the HTTP seam: successful login, wrong password, rate limit, session expiry with the fake clock moved ahead, logout
