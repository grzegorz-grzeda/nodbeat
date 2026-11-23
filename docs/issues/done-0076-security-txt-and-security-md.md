# 0076: security.txt and SECURITY.md

Spec: 0019
Status: done

**What to build:** Security researchers find where to report a vulnerability: `/.well-known/security.txt` on the instance and `SECURITY.md` in the repo.

**Blocked by:** None (can start immediately).

- [x] `/.well-known/security.txt` (RFC 9116) with `Contact` from `SECURITY_CONTACT`, `Expires` one year from build, `Preferred-Languages: en, pl`, `Policy` linking `SECURITY.md`; `text/plain`
- [x] `SECURITY_CONTACT` unset → `404`
- [x] `SECURITY.md`: GitHub private vulnerability reporting, latest release supported, first answer within 7 days
- [x] `docs/deploy.md` mentions `SECURITY_CONTACT`
- [x] Tests: served with a valid `Expires` when set, `404` when unset

## Comments

- `src/security-txt.ts`. The build time comes from the new `APP_BUILT_AT` build arg, set by the release workflow; without it (local dev, tests) Expires counts from startup.
- `SECURITY_CONTACT` is checked at startup: a `mailto:` with an address or an https URL.
- GitHub private vulnerability reporting must be switched on in the repo settings for `SECURITY.md`'s route to work.
