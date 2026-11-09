# 0016: Swagger UI at /docs

Spec: 0003
Status: done

**What to build:** A public `/docs` page shows the OpenAPI document in Swagger UI, served entirely from nodbeat's own assets, so a User can read the Heartbeat URL reference and send a test Heartbeat with "Try it out" without logging in.

**Blocked by:** 0015 (the document), 0011 (CSP header).

- [x] `GET /docs` public, plain Swagger UI page (no app nav/footer, light theme only) loading `/openapi.yaml`
- [x] Swagger UI assets served by nodbeat itself, never from a CDN
- [x] No inline `<script>` or `<style>`; passes `Content-Security-Policy: default-src 'self'` (serve the Swagger UI initializer as a static asset if needed)
- [x] "Try it out" enabled against `PUBLIC_BASE_URL`
- [x] A "← nodbeat" link back to the app
- [x] Tests through the HTTP seam: 200 HTML, CSP header present, no inline `<script>`/`<style>`, every asset the page references answers 200
