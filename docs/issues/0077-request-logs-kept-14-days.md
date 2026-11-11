# 0077: Request logs kept 14 days

Spec: 0019
Status: ready-for-agent

**What to build:** Request logs holding visitor IPs are kept at most 14 days on the server, so the Privacy policy's promise is true.

**Blocked by:** None (can start immediately).

- [ ] `compose.yaml` logging rotates by time with at most 14 days kept (`local`/`journald` driver, or `json-file` plus a daily logrotate, whichever works on the VPS)
- [ ] `docs/deploy.md` explains the setup and how to check it, and notes that the edge Caddy needs the same limit in the edge repo
- [ ] CHANGELOG entry
