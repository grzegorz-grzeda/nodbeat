# 0040: Create and accept Invites

Spec: 0008
Status: ready-for-agent

**What to build:** The Admin creates an Invite (optional note) and sees its link once; the invited person opens it, picks email, password and time zone, and is logged in on the Dashboard as a non-Admin User.

**Blocked by:** 0032.

- [ ] `invites` collection: `_id` = sha256 of the code, `note`, `createdBy`, `createdAt`, `expiresAt` (7 days), `revokedAt`, `usedAt`, `usedBy`
- [ ] Code: 32 random bytes, base64url; link `PUBLIC_BASE_URL/invite/<code>`
- [ ] `GET /admin/invites` with a create form; `POST /admin/invites` → one-time page with the link and a copy button (both behind `requireAdmin`); Admin page links there
- [ ] `GET /invite/:code` shows the form, or a "this Invite can't be used" page for unknown, used, expired or revoked codes
- [ ] `POST /invite/:code`: atomic claim of a pending Invite, then `createUser` with `isAdmin: false`, then a session like a login; on a `UserError` the Invite is released and the form shows the error
- [ ] Both `/invite/:code` routes CSRF-protected and rate-limited per IP (10 per 15 min, `SlidingWindowLimiter`)
- [ ] Landing page says "nodbeat is invite-only for now"; still no sign-up link
- [ ] `GLOSSARY.md`: add Invite
- [ ] Tests through the HTTP seam: Admin creates → accept → Dashboard, can create a Monitor, `/admin` → 404; same link again → "can't be used"; advance 7 days → "can't be used"; email taken → form error, Invite still works; two parallel accepts → one User; non-Admin → 404 on `/admin/invites`; 11th request from one IP → `429`; CLI `create-user` unchanged
