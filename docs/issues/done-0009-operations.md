# 0009: Operations: self-Heartbeat, backups, deploy guide

Spec: 0001
Status: done

**What to build:** nodbeat reports its own liveness to an external service. Its data is backed up nightly. A guide takes me from nothing to a running `nodbeat.g2labs.pl`.

**Blocked by:** 0001.

- [x] When its env var is set, nodbeat sends a GET to an external self-Heartbeat URL (e.g. healthchecks.io) every 60 s; failures are only logged
- [x] A nightly backup script runs `mongodump` without the raw Heartbeats collection and copies the result to Google Drive with `rclone`
- [x] Deploy guide covers: the Atlas project `nodbeat` with an M0 cluster in Frankfurt and its user/network access; the bot from BotFather; the DNS record; the `nodbeat.g2labs.pl` site in the edge repo; `.env` setup; `docker compose up`; creating the Admin User with the CLI; the backup cron; the external self-Heartbeat check
