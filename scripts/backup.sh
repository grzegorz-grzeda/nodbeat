#!/usr/bin/env bash
# Nightly backup: mongodump (without raw Heartbeats), encrypted with age, streamed to Google Drive with rclone.
# No plaintext archive touches the disk: mongodump | age | rclone rcat.
#
# Needs on the host: mongodump (MongoDB Database Tools), age and rclone with a configured remote.
# Env:
#   MONGODB_URI           connection string; read from ENV_FILE when unset
#   BACKUP_AGE_RECIPIENT  age public key (age1...) to encrypt to; read from ENV_FILE when unset; required
#   ENV_FILE              defaults to the repo's .env
#   RCLONE_REMOTE         rclone destination, default "gdrive:nodbeat-backups"
#   RETENTION_DAYS        backups older than this are removed from the remote, default 30
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$repo_dir/.env}"
remote="${RCLONE_REMOTE:-gdrive:nodbeat-backups}"
retention_days="${RETENTION_DAYS:-30}"

# Last NAME= line of the env file; strip CR and one pair of surrounding quotes.
read_env() {
  local value
  value="$(grep -E "^$1=" "$env_file" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  value="${value#[\"\']}"
  value="${value%[\"\']}"
  printf '%s' "$value"
}

if [[ -z "${MONGODB_URI:-}" && -f "$env_file" ]]; then
  MONGODB_URI="$(read_env MONGODB_URI)"
fi
if [[ -z "${BACKUP_AGE_RECIPIENT:-}" && -f "$env_file" ]]; then
  BACKUP_AGE_RECIPIENT="$(read_env BACKUP_AGE_RECIPIENT)"
fi
if [[ -z "${MONGODB_URI:-}" ]]; then
  echo "backup: MONGODB_URI is not set (and not found in $env_file)" >&2
  exit 1
fi
if [[ -z "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  echo "backup: BACKUP_AGE_RECIPIENT is not set (and not found in $env_file); refusing to upload an unencrypted backup" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
name="nodbeat-$(date -u +%Y%m%dT%H%M%SZ).archive.gz.age"
# Upload under a name the retention filter doesn't match; rename only once the whole pipeline succeeded.
partial="partial-$name"

# Pass the URI through a private config file so its password doesn't show in `ps`.
config="$work_dir/mongodump.yaml"
(umask 077 && printf 'uri: "%s"\n' "$MONGODB_URI" >"$config")

if ! mongodump --config="$config" --excludeCollection=heartbeats --archive --gzip --quiet |
  age -r "$BACKUP_AGE_RECIPIENT" |
  rclone rcat "$remote/$partial"; then
  echo "backup: failed; removing $partial from $remote" >&2
  rclone deletefile "$remote/$partial" 2>/dev/null || true
  exit 1
fi
rclone moveto "$remote/$partial" "$remote/$name"
rclone delete "$remote" --include "nodbeat-*.archive.gz.age" --min-age "${retention_days}d"

echo "backup: uploaded $name to $remote"
