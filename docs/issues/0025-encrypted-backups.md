# 0025: Encrypted backups

Spec: 0004
Status: ready-for-agent

**What to build:** The nightly backup is encrypted with `age` on the VPS before it's uploaded, so Google Drive only ever holds ciphertext.

**Blocked by:** none.

- [ ] `scripts/backup.sh` requires `BACKUP_AGE_RECIPIENT` (env or `.env`) and refuses to run without it
- [ ] The archive is piped through `age -r "$BACKUP_AGE_RECIPIENT"` and uploaded as `nodbeat-*.archive.gz.age`; no plaintext archive touches the disk
- [ ] Retention cleanup matches the new file name
- [ ] `docs/deploy.md`: install `age`, generate a key pair off the VPS, put only the public recipient on the VPS, and how to restore (`age -d -i key.txt ... | mongorestore --archive --gzip`)
- [ ] Checked by running the script against a test database and restoring from its output
