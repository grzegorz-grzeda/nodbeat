# Tag-triggered deploys of prebuilt images from GHCR

The SSH deploy step is superseded by ADR 0006: the VPS now pulls `:latest` once a day.

nodbeat is deployed only when a SemVer tag `vX.Y.Z` is pushed. GitHub Actions builds the Docker image, pushes it to GHCR as `ghcr.io/grzegorz-grzeda/nodbeat:X.Y.Z`, then SSHes into the VPS to `docker compose pull && up -d` that exact version. `compose.yaml` refers to the image, not `build: .`. Every push to `main` is pushed to `origin` after each issue, so deploying on push would ship half-finished features; tags make each deploy a release with a version the UI can show. Building in CI keeps the 1 vCPU / 2 GB VPS free for the apps running on it, and keeping old images makes a rollback a redeploy of an earlier tag.

## Considered Options

- **SSH, `git pull` and `docker compose up --build` on the VPS**: rejected because the build competes with running apps for CPU and memory, and a rollback means rebuilding an old commit.
- **Deploy on every push to `main`**: rejected because `main` gets pushed after every issue, not every release.

## Consequences

- The VPS needs a deploy SSH key and network access to GHCR. The image is public because the repo is.
- A tag that doesn't match `package.json` is refused, so the displayed version is always the deployed one.
