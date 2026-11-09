# 0001: Walking skeleton

Spec: 0001
Status: ready-for-agent

**What to build:** A deployable empty nodbeat. `GET /health` answers ok when Mongo can be pinged. The app is built through the `createApp({ db, clock, telegram, config })` composition root that every later test goes through, and it runs as a container on the shared `edge` network.

**Blocked by:** None (can start immediately).

- [ ] Project tooling: pnpm, TypeScript, Fastify, MongoDB driver, Vitest with mongodb-memory-server, ESLint + Prettier; `pnpm test` and `pnpm lint` pass
- [ ] `createApp` accepts an injected db, clock, Telegram client and config; there is a test helper that builds the app with a fake clock and a recording Telegram fake
- [ ] Configuration is read and checked from environment variables (Mongo URI, public base URL, session secret, Telegram token and webhook secret); missing required values fail fast with a clear message; an `.env.example` is provided
- [ ] `GET /health` returns 200 `ok` when Mongo responds and a non-200 otherwise, covered by a test through the HTTP seam
- [ ] Multi-stage Dockerfile; a Compose service `nodbeat` listening on 3000, joining the external `edge` network, with no published ports
- [ ] package version `0.1.0`
