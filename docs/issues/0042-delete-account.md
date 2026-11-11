# 0042: Delete account

Spec: 0012
Status: ready-for-agent

**What to build:** A User deletes their own account from Settings by confirming their password. Everything they own goes with it and they land on the landing page with "Your account was deleted".

**Blocked by:** none.

- [ ] Settings shows "Delete account" for non-Admin Users; the confirmation page lists what will be deleted (Monitor and Alert channel counts)
- [ ] Wrong password shows the page again with an error and counts towards the login limit; nothing is deleted
- [ ] Deleting removes the User's sessions first, then queued Alerts, Monitors with their Heartbeats, Incidents and state periods, Linked chats, Link codes, then the User
- [ ] A User marked as being deleted can't log in; a deletion interrupted midway is finished at startup
- [ ] Heartbeat URLs of deleted Monitors answer `404` at once
- [ ] A chat linked by two Users stays linked for the other User
- [ ] The Invite list shows "used by (deleted User)" for an Invite the deleted User accepted
- [ ] Admin sees no button; both routes answer `404` for the Admin
- [ ] The POST needs a valid CSRF token
- [ ] Admin page totals and the per-User table no longer count the deleted User or their data
- [ ] Tests through the HTTP seam: full deletion leaves no documents of the User; wrong password deletes nothing; Admin `404`; shared chat survives; interrupted deletion finishes on restart; Admin page totals drop the deleted User; Invite shows "(deleted User)"
