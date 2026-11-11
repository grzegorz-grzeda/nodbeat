# 0057: Accept the Terms on Invite

Spec: 0014
Status: resolved

**What to build:** A new User must tick "I accept the Terms and Privacy policy" before their account is created through an Invite, and the accepted versions and times are recorded.

**Blocked by:** 0056

- [x] Required checkbox on the Invite accept page when the legal files exist; missing → error, no User created
- [x] `users.accepted: { terms: { version, at }, privacy: { version, at } }` recorded at creation
- [x] Legal files missing → no checkbox
- [x] Tests: without the checkbox → error; with it → versions recorded
- [x] If "Download my data" (issue 0075) exists, the export includes the new User data (0075 not built yet; it covers `accepted` itself)
