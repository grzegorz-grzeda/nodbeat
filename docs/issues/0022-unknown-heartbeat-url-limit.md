# 0022: Limit unknown Heartbeat URLs per IP

Spec: 0004
Status: ready-for-agent

**What to build:** An IP that sends more than 30 requests per minute to unknown Heartbeat URLs gets `429` for every `/hb/:token` request without a database lookup, so scanning can't load Atlas.

**Blocked by:** none.

- [ ] In-memory per-IP limiter counting `404`s from `/hb/:token`, 30 per minute
- [ ] Over the limit, `/hb/:token` answers `429 Too Many Requests` (plain text) before looking up the token
- [ ] Known tokens keep their 1-per-second limit
- [ ] `api/openapi.yaml` describes this `429`
- [ ] Tests through the HTTP seam: 30 unknown tokens get `404`, the 31st gets `429`, a valid token from the same IP gets `429` too, and everything works again after a minute; another IP isn't affected
