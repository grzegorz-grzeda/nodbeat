# 0019: Trust only the edge Caddy as proxy

Spec: 0004
Status: done

**What to build:** nodbeat reads the client IP from `X-Forwarded-For` only when the request comes from the edge Caddy's fixed address, so another container on the `edge` network can't fake its IP.

**Blocked by:** none. Deploying it needs the edge Caddy's fixed IP set in `grzegorz-grzeda/edge` first (manual).

- [x] New required env var `TRUSTED_PROXY_IP`, checked by `loadConfig` (a valid IPv4 or IPv6 address)
- [x] Fastify `trustProxy` trusts only that address
- [x] `.env.example` and `docs/deploy.md` describe it, including giving Caddy a fixed IP on the `edge` network in the edge repo
- [x] Tests through the HTTP seam: a request from another address with a forged `X-Forwarded-For` is limited as its real peer; a request from `TRUSTED_PROXY_IP` is limited as the forwarded client
