# 0077: Request logs kept 14 days

Spec: 0019
Status: done

**What to build:** Request logs holding visitor IPs are kept at most 14 days on the server, so the Privacy policy's promise is true.

**Blocked by:** None (can start immediately).

- [x] `compose.yaml` logging rotates by time with at most 14 days kept (`local`/`journald` driver, or `json-file` plus a daily logrotate, whichever works on the VPS)
- [x] `docs/deploy.md` explains the setup and how to check it, and notes that the edge Caddy needs the same limit in the edge repo
- [x] CHANGELOG entry

## Comments

- journald, not `local` (which also rotates only by size) or logrotate (which fights Docker's own file handles). The 14 days are a host setting, a journald drop-in, documented in `docs/deploy.md` step 6 with how to check it.
- Not tried on the VPS from here: the Operator applies the drop-in and recreates the container. The edge Caddy's limit is in the edge repo.
