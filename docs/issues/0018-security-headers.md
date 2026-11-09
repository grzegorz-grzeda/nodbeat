# 0018: Security headers

Spec: 0004
Status: ready-for-agent

**What to build:** Every response, HTML or not, carries headers that make browsers protect the session: HSTS, `nosniff`, a same-origin Referrer-Policy and a CSP that forbids framing.

**Blocked by:** none.

- [ ] One `onSend` hook sets `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` on every response
- [ ] CSP becomes `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, sent on every response (not only HTML)
- [ ] The Swagger UI page and "Try it out" still work under the new CSP
- [ ] Tests through the HTTP seam: the headers are on an HTML page, `/dashboard.json`, `/hb/:token`, `/health`, an asset and `/docs`
