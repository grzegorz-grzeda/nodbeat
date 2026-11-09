# 0002: Users and login

Spec: 0001
Status: done

**What to build:** I can create my User (with the Admin flag) from the CLI, log in with my email and password, see an empty Dashboard, and log out. Unauthenticated visitors are sent to the login page.

**Blocked by:** 0001.

- [x] CLI command creates a User with email, password, Admin flag and time zone (default Europe/Warsaw); the email is unique
- [x] Passwords are hashed with argon2id
- [x] Login and logout; sessions are stored in Mongo with a 30-day sliding expiry; the cookie is HttpOnly, Secure and SameSite=Lax
- [x] Login is limited to 5 attempts per 15 minutes per IP, after which it is rejected
- [x] Every state-changing form is CSRF-protected
- [x] The Dashboard requires login and shows an empty state
- [x] Tests through the HTTP seam: successful login, wrong password, rate limit, session expiry with the fake clock moved ahead, logout
