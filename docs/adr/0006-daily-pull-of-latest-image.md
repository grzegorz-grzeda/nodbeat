# Daily pull of the latest image on the VPS

Supersedes the deploy step of ADR 0005. Releases are still cut by pushing a SemVer tag `vX.Y.Z`, and GitHub Actions still tests, builds and pushes the image to GHCR. It now tags the image both `X.Y.Z` and `latest`. GitHub no longer connects to the VPS at all. Instead, a cron job in the owner's crontab runs `scripts/update.sh` in `~/nodbeat` at 03:00 every day. The script does `docker compose pull` and `up -d`, and the container is recreated only when `latest` has moved. `compose.yaml` names `:latest`, and `.env` holds no version.

The SSH deploy needed a private key, the host and known_hosts as GitHub secrets. Its user could run `docker`, which is root on the VPS, so a leaked secret would have given away the whole VPS. Pulling removes every VPS secret from GitHub and every moving part on the VPS except one cron line. Deploying at 03:00 also fits a hobby service: a restart happens when nobody is looking, and startup grace (ADR 0002) keeps it from raising false Alerts.

## Considered Options

- **Keep the SSH push, restricted to a forced-command deploy script**: rejected. It's safer than a full shell but still keeps a VPS key in GitHub, and it needs a deploy user and a sudoers rule.
- **Poll for new tags every minute and deploy the newest one**: rejected as more machinery than a once-a-day release cadence needs.

## Consequences

- A release goes live at the next 03:00, not when the tag is pushed. To go live straight away, run `~/nodbeat/scripts/update.sh` by hand.
- The release workflow no longer waits for `/health`, so a release that fails to start isn't caught by CI. The external self-Heartbeat check (healthchecks.io) is what notices.
- `latest` points at whatever was pushed last. A patch tagged for an older line after a newer release would move `latest` backwards, so tag releases only in order.
- Rollback: run the Release workflow by hand with an earlier version, which points `latest` at that image, then run `scripts/update.sh` or wait for 03:00.
- `compose.yaml` and the scripts on the VPS are not updated by the job. When they change, `git pull` in `~/nodbeat` by hand.
