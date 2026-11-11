# 0057: Accept the Terms on Invite

Spec: 0014
Status: ready-for-agent

**What to build:** A new User must tick "I accept the Terms and Privacy policy" before their account is created through an Invite, and the accepted versions and times are recorded.

**Blocked by:** 0056

- [ ] Required checkbox on the Invite accept page when the legal files exist; missing → error, no User created
- [ ] `users.accepted: { terms: { version, at }, privacy: { version, at } }` recorded at creation
- [ ] Legal files missing → no checkbox
- [ ] Tests: without the checkbox → error; with it → versions recorded
- [ ] If "Download my data" (issue 0075) exists, the export includes the new User data
