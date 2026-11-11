# 0076: security.txt and SECURITY.md

Spec: 0019
Status: ready-for-agent

**What to build:** Security researchers find where to report a vulnerability: `/.well-known/security.txt` on the instance and `SECURITY.md` in the repo.

**Blocked by:** None (can start immediately).

- [ ] `/.well-known/security.txt` (RFC 9116) with `Contact` from `SECURITY_CONTACT`, `Expires` one year from build, `Preferred-Languages: en, pl`, `Policy` linking `SECURITY.md`; `text/plain`
- [ ] `SECURITY_CONTACT` unset → `404`
- [ ] `SECURITY.md`: GitHub private vulnerability reporting, latest release supported, first answer within 7 days
- [ ] `docs/deploy.md` mentions `SECURITY_CONTACT`
- [ ] Tests: served with a valid `Expires` when set, `404` when unset
