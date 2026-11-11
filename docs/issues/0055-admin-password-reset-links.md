# 0055: Admin password reset links

Spec: 0013
Status: ready-for-agent

**What to build:** The Admin creates a one-time password reset link for a User from the Admin page. The User opens it, sets a new password, and every other session of theirs is logged out.

**Blocked by:** None (can start immediately).

- [ ] `POST /admin/users/:id/reset-link` (Admin only) shows the link once; one live link per User, a new one replaces the old
- [ ] `password_resets` stored like `invites` (sha256 `_id`, `userId`, `expiresAt`, `usedAt`); valid 24 h, single use
- [ ] `GET|POST /reset/:code` public, rate-limited per IP like Invites
- [ ] Setting the password logs out all the User's sessions
- [ ] Tests: new password works, old sessions `401`, reused link → "can't be used", after 24 h → expired, replaced link no longer works
