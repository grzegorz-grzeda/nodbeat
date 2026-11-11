# 0022: Limit unknown Heartbeat URLs per IP

Spec: 0004
Status: done

**What to build:** An IP that sends more than 30 requests per minute to unknown Heartbeat URLs gets `429` for every `/hb/:token` request without a database lookup, so scanning can't load Atlas.

**Blocked by:** none.

- [x] In-memory per-IP limiter counting `404`s from `/hb/:token`, 30 per minute
- [x] Over the limit, `/hb/:token` answers `429 Too Many Requests` (plain text) before looking up the token
- [x] Known tokens keep their 1-per-second limit
- [x] `api/openapi.yaml` describes this `429`
- [x] Tests through the HTTP seam: 30 unknown tokens get `404`, the 31st gets `429`, a valid token from the same IP gets `429` too, and everything works again after a minute; another IP isn't affected
