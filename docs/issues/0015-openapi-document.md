# 0015: OpenAPI document

Spec: 0003
Status: ready-for-agent

**What to build:** `GET /openapi.yaml` serves a hand-written OpenAPI 3 document describing the Heartbeat URL and `/health`, stamped with the running version and this instance's public URL, so a developer can import it into Postman or a code generator.

**Blocked by:** none (0010 is done).

- [ ] Hand-written OpenAPI 3 YAML document kept in the repo (not generated from route schemas)
- [ ] Served public at `/openapi.yaml` as `application/yaml`, with `info.version` = the running build's version and `servers` = `PUBLIC_BASE_URL`
- [ ] `GET` and `POST /hb/{token}`, with a placeholder `token` example: message from `?msg=` first, then the body (`text/plain`, no Content-Type, `application/json` `{"msg"}`, form `msg`); broken JSON taken as text; message trimmed and cut to 200 characters
- [ ] Heartbeat URL responses, all `text/plain`: 200 (recorded), 404 (unknown token, e.g. regenerated Heartbeat URL or deleted Monitor), 429 (more than one Heartbeat per second per Monitor), 413 (body over 8 KiB)
- [ ] `GET /health`: 200 `{"status":"ok","version","commit"}`, 503 `{"status":"mongo unavailable","version","commit"}`
- [ ] Wording uses Monitor, Heartbeat, Heartbeat URL; never "endpoint", "ping" or "check"
- [ ] Tests through the HTTP seam: 200, parses as YAML, has both `/hb/{token}` operations and `/health`, `info.version` equals the build version, `servers` uses `PUBLIC_BASE_URL`
