# 0041: Invite list and revoke

Spec: 0008
Status: ready-for-agent

**What to build:** `/admin/invites` lists every Invite with its status, and the Admin can revoke a pending one after confirming.

**Blocked by:** 0040.

- [ ] List: note, created, expires, and status: pending, expired, revoked, or used by <email> at <time>; newest first; times in the Admin's time zone
- [ ] `GET /admin/invites/:id/revoke` confirmation page (`sendConfirmPage`), `POST` sets `revokedAt` on a pending Invite and sets a Flash message; non-pending → back to the list unchanged
- [ ] Tests through the HTTP seam: list shows each status after creating, accepting, expiring and revoking Invites; revoked link → "can't be used"; revoking a used Invite changes nothing; non-Admin → 404 on both revoke routes
