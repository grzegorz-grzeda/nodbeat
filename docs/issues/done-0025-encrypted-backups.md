# 0025: Encrypted backups

Spec: 0004
Status: resolved

**What to build:** The nightly backup is encrypted with `age` on the VPS before it's uploaded, so Google Drive only ever holds ciphertext.

**Blocked by:** none.

- [x] `scripts/backup.sh` requires `BACKUP_AGE_RECIPIENT` (env or `.env`) and refuses to run without it
- [x] The archive is piped through `age -r "$BACKUP_AGE_RECIPIENT"` and uploaded as `nodbeat-*.archive.gz.age`; no plaintext archive touches the disk
- [x] Retention cleanup matches the new file name
- [x] `docs/deploy.md`: install `age`, generate a key pair off the VPS, put only the public recipient on the VPS, and how to restore (`age -d -i key.txt ... | mongorestore --archive --gzip`)
- [ ] Checked by running the script against a test database and restoring from its output

Note: run against a throwaway `mongod` and restored with stand-ins for `age` and `rclone` (neither is installed on the dev machine): refusal without a recipient, the `mongodump | age | rclone rcat` pipeline, rename after success, cleanup of the partial upload on failure, and `age -d | mongorestore --archive --gzip` all worked. Still to do on a host with real `age` and `rclone`: one run plus a restore.

## Comments

- 2026-11-11: closed on request with the real-`age` run still unchecked; do one backup + restore on the VPS after deploy.
