#!/usr/bin/env bash
# Nightly backup: mongodump (without raw Heartbeats) copied to Google Drive with rclone.
#
# Needs on the host: mongodump (MongoDB Database Tools) and rclone with a configured remote.
# Env:
#   MONGODB_URI      connection string; read from ENV_FILE when unset
#   ENV_FILE         defaults to the repo's .env
#   RCLONE_REMOTE    rclone destination, default "gdrive:nodbeat-backups"
#   RETENTION_DAYS   backups older than this are removed from the remote, default 30
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$repo_dir/.env}"
remote="${RCLONE_REMOTE:-gdrive:nodbeat-backups}"
retention_days="${RETENTION_DAYS:-30}"

if [[ -z "${MONGODB_URI:-}" && -f "$env_file" ]]; then
  # Last MONGODB_URI= line; strip CR and one pair of surrounding quotes.
  MONGODB_URI="$(grep -E '^MONGODB_URI=' "$env_file" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  MONGODB_URI="${MONGODB_URI#[\"\']}"
  MONGODB_URI="${MONGODB_URI%[\"\']}"
fi
if [[ -z "${MONGODB_URI:-}" ]]; then
  echo "backup: MONGODB_URI is not set (and not found in $env_file)" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
archive="$work_dir/nodbeat-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"

# Pass the URI through a private config file so its password doesn't show in `ps`.
config="$work_dir/mongodump.yaml"
(umask 077 && printf 'uri: "%s"\n' "$MONGODB_URI" >"$config")

mongodump --config="$config" --excludeCollection=heartbeats \
  --archive="$archive" --gzip --quiet

rclone copy "$archive" "$remote"
rclone delete "$remote" --include "nodbeat-*.archive.gz" --min-age "${retention_days}d"

echo "backup: uploaded $(basename "$archive") to $remote"
