# 0054: Manage Login methods

Spec: 0013
Status: ready-for-agent

**What to build:** Settings lists the User's Login methods; the User can remove any but the last, and add or remove a password. The Admin's per-User table shows each User's Login methods.

**Blocked by:** 0051

- [ ] Settings lists password / Google / GitHub with when each was connected
- [ ] Removing a Login method works unless it's the last one, which is refused
- [ ] A User without a password can set one; a User with another Login method can remove their password
- [ ] Password change and "Log out everywhere" keep working as now
- [ ] Admin per-User table has a Login methods column
- [ ] Tests through the HTTP seam for each point
