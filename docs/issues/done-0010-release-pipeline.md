# 0010: Release pipeline

Spec: 0002
Status: ready-for-agent

**What to build:** Pushing a tag `vX.Y.Z` tests, builds and deploys nodbeat to the VPS, and `/health` reports the running version and commit. CI runs on every push to `main`.

**Blocked by:** none.

- [x] `APP_VERSION` / `APP_COMMIT` baked into the image as build args; dev falls back to `package.json` version and `dev`
- [x] `/health` returns `{"status","version","commit"}` (200 ok, 503 mongo unavailable)
- [x] CI workflow on push to `main`: typecheck, test, lint
- [x] Release workflow on `v*.*.*` tag: tag = `package.json` check, typecheck/test/lint, build, push `ghcr.io/grzegorz-grzeda/nodbeat:<X.Y.Z>`, SSH deploy, `/health` version check (90 s timeout), GitHub Release from `CHANGELOG.md`
- [x] `workflow_dispatch` with `version` input redeploys an existing image without building
- [x] `compose.yaml` uses `image: ghcr.io/grzegorz-grzeda/nodbeat:${NODBEAT_VERSION:?}`
- [x] `CHANGELOG.md` (Keep a Changelog) with history back to 0.9.0
- [x] `docs/deploy.md`: deploy key, GitHub secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`), public GHCR package, how to release and roll back
- [x] Tests: `/health` shape for ok and Mongo down
