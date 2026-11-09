#!/usr/bin/env bash
# Daily update: pull the newest released image (:latest) and restart nodbeat only if it changed (ADR 0006).
# Run from cron as the user that owns the checkout and can run docker.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose pull --quiet
# Recreates the container only when the pulled image differs from the running one.
docker compose up -d
# Drops the image the previous :latest pointed at.
docker image prune -f > /dev/null

echo "update: $(date -u +%FT%TZ) running $(docker compose exec -T nodbeat printenv APP_VERSION)"
