# 0079: Delete account without a password

Spec: 0012
Status: ready-for-agent

**What to build:** A User who logs in only with Google or GitHub can delete their account by logging in again with Google/GitHub instead of typing a password, and their Login methods go with the account, so the same Google/GitHub account can sign up or be invited again later.

**Blocked by:** 0042, 0053

- [ ] The confirmation page offers "Confirm with Google/GitHub" for a User without a password; the OAuth flow runs with a delete intent and must return one of the User's own Login methods
- [ ] A different Google/GitHub account, a `state` mismatch or a missing PKCE cookie → nothing deleted
- [ ] Login methods are deleted with the User; afterwards the same Google account can accept a new Invite
- [ ] Tests through the HTTP seam with the fake provider: passwordless User deletes by re-login; wrong provider account deletes nothing; same Google account accepted on a new Invite afterwards
