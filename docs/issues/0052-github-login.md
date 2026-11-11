# 0052: GitHub login

Spec: 0013
Status: ready-for-agent

**What to build:** GitHub works as a second Login method everywhere Google does: connect in Settings and log in with "Log in with GitHub".

**Blocked by:** 0051

- [ ] `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` optional; a provider without both is hidden
- [ ] Subject from GitHub `/user` `id`, email from `/user/emails` primary verified address
- [ ] No verified primary email → refused
- [ ] Tests: connect GitHub, log out, log in with GitHub; no verified primary email refused
