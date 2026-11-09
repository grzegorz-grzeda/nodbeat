# Deploying nodbeat

From nothing to a running `https://nodbeat.g2labs.pl` on the VPS. The VPS already runs Docker and the shared edge Caddy (`grzegorz-grzeda/edge`, ADR 0004).

## 1. MongoDB Atlas (ADR 0003)

1. In Atlas, create a new project named `nodbeat`.
2. Create a cluster: **M0 (free)**, provider AWS, region **Frankfurt (eu-central-1)**.
3. **Database Access** → add a database user (password auth), e.g. `nodbeat`, role _Read and write to any database_. Generate a strong password.
4. **Network Access** → add the VPS's public IP (`/32`). Don't use `0.0.0.0/0`.
5. **Connect → Drivers** → copy the `mongodb+srv://` string. Put the user and password in it and add the database name as the path:

   ```
   mongodb+srv://nodbeat:<password>@<cluster>.mongodb.net/nodbeat?retryWrites=true&w=majority
   ```

   nodbeat refuses to start when the path has no database name. Indexes are created at startup.

## 2. Telegram bot

1. In Telegram, talk to [@BotFather](https://t.me/BotFather): `/newbot`, choose a name and a username (e.g. `nodbeat_bot`).
2. Copy the bot token into `TELEGRAM_BOT_TOKEN`.
3. Optionally set the description and commands (`/setcommands`):

   ```
   start - Link this chat with a code from Settings
   status - Show your Monitors
   unlink - Stop Alerts in this chat
   ```

4. Generate a webhook secret for `TELEGRAM_WEBHOOK_SECRET`: `openssl rand -hex 32` (Telegram allows `A-Z a-z 0-9 _ -` only).

## 3. DNS

Add an `A` record (and `AAAA` if the VPS has IPv6) for `nodbeat.g2labs.pl` pointing at the VPS. Check with `dig +short nodbeat.g2labs.pl` before step 4, so Caddy can get a certificate.

## 4. Edge Caddy site

In the edge repo (`grzegorz-grzeda/edge`), add a site block to its Caddyfile:

```caddy
nodbeat.g2labs.pl {
	encode zstd gzip
	reverse_proxy nodbeat:3000
}
```

Commit, push, and reload the edge Caddy on the VPS (e.g. `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`, or however the edge repo documents it). The `edge` Docker network must exist (`docker network ls | grep edge`); the edge project creates it.

## 5. `.env`

On the VPS:

```sh
git clone https://github.com/grzegorz-grzeda/nodbeat.git ~/nodbeat
cd ~/nodbeat
cp .env.example .env
chmod 600 .env
```

Fill it in:

| Variable                  | Value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| `NODBEAT_VERSION`         | the version to run, e.g. `0.10.0` (rewritten by deploys)   |
| `MONGODB_URI`             | the string from step 1                                     |
| `PUBLIC_BASE_URL`         | `https://nodbeat.g2labs.pl`                                |
| `SESSION_SECRET`          | `openssl rand -base64 48`                                  |
| `TELEGRAM_BOT_TOKEN`      | from step 2                                                |
| `TELEGRAM_WEBHOOK_SECRET` | from step 2                                                |
| `SELF_HEARTBEAT_URL`      | from step 9 (leave empty for now; set it and restart then) |

## 6. Start

`compose.yaml` runs the prebuilt image `ghcr.io/grzegorz-grzeda/nodbeat:${NODBEAT_VERSION}` (ADR 0005); nothing is built on the VPS. Set `NODBEAT_VERSION` in `.env` to a released version, then:

```sh
docker compose pull
docker compose up -d
docker compose logs -f nodbeat
```

nodbeat prints every configuration problem and exits if `.env` is wrong. Once it listens, `https://nodbeat.g2labs.pl/health` answers `{"status":"ok","version":"X.Y.Z","commit":"<sha>"}`.

Later versions are deployed by the release workflow (step 10), which keeps `NODBEAT_VERSION` in `.env` up to date. `0.10.0` is the first version with a published image; on a VPS still running the old `build: .` setup, the first release deploy switches it over by itself.

## 7. Admin User

There is no registration. Create the Admin from the CLI; the password is read from stdin and never lands in shell history:

```sh
docker compose exec -it nodbeat node dist/cli-main.js create-user --email you@example.com --admin --time-zone Europe/Warsaw
```

Log in at `https://nodbeat.g2labs.pl`.

## 8. Nightly backup

M0 has no automated backups. `scripts/backup.sh` runs `mongodump` without the raw `heartbeats` collection (they expire after 7 days anyway) and copies a gzipped archive to Google Drive with `rclone`, removing its own archives older than 30 days.

On the VPS host:

1. Install the [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/installation/) (`mongodump`) and [rclone](https://rclone.org/install/).
2. `rclone config` → new remote named `gdrive`, type _Google Drive_, scope `drive.file`. On a headless VPS, use the `rclone authorize "drive"` flow from a machine with a browser.
3. Try it once: `~/nodbeat/scripts/backup.sh`, then `rclone ls gdrive:nodbeat-backups`.
4. `crontab -e`:

   ```cron
   30 3 * * * ~/nodbeat/scripts/backup.sh >> ~/nodbeat-backup.log 2>&1
   ```

The script reads `MONGODB_URI` from `~/nodbeat/.env`. Override with env vars: `RCLONE_REMOTE` (default `gdrive:nodbeat-backups`), `RETENTION_DAYS` (default `30`), `ENV_FILE`.

To restore: `rclone copy gdrive:nodbeat-backups/<file> .` then `mongorestore --uri="$MONGODB_URI" --archive=<file> --gzip --drop`.

Optionally signal a second healthchecks.io check at the end of the cron line (`&& curl -fsS -m 10 --retry 3 <check-url>`) so a silently failing backup gets noticed.

## 9. External self-Heartbeat

nodbeat can't alert about its own death, so something outside must watch it.

1. On [healthchecks.io](https://healthchecks.io), create a check named `nodbeat`: period **1 minute**, grace **3 minutes**. Add an email (or other) integration that doesn't depend on nodbeat.
2. Copy the check's URL into `SELF_HEARTBEAT_URL` in `.env`.
3. `docker compose up -d` to restart with it.

nodbeat sends a GET to that URL at startup and every 60 s. Failures are only logged. Within a minute the check should turn green.

## 10. Releases (ADR 0005)

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`:

1. checks the tag matches the `package.json` version and that `CHANGELOG.md` has a `## [X.Y.Z]` section;
2. runs typecheck, tests and lint;
3. builds the image with `APP_VERSION` / `APP_COMMIT` baked in and pushes `ghcr.io/grzegorz-grzeda/nodbeat:X.Y.Z`;
4. over SSH: `cd ~/nodbeat`, checks out `vX.Y.Z`, sets `NODBEAT_VERSION=X.Y.Z` in `.env`, `docker compose pull && docker compose up -d`;
5. polls `https://nodbeat.g2labs.pl/health` until it reports `X.Y.Z`, failing after 90 s (there is no automatic rollback);
6. creates the GitHub Release `vX.Y.Z` with that `CHANGELOG.md` section as its notes.

`.github/workflows/ci.yml` runs typecheck, tests and lint on every push to `main`.

### One-time setup

1. **Deploy key.** On your machine: `ssh-keygen -t ed25519 -N "" -C nodbeat-deploy -f nodbeat-deploy`. Append `nodbeat-deploy.pub` to `~/.ssh/authorized_keys` of the deploy user on the VPS. That user must be able to run `docker` and own `~/nodbeat`.
2. **Known hosts.** `ssh-keyscan -t ed25519 <vps-host>` and check the fingerprint against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS.
3. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):

   | Secret            | Value                                        |
   | ----------------- | -------------------------------------------- |
   | `VPS_HOST`        | the VPS hostname or IP                       |
   | `VPS_USER`        | the deploy user                              |
   | `VPS_SSH_KEY`     | contents of the private key `nodbeat-deploy` |
   | `VPS_KNOWN_HOSTS` | the `ssh-keyscan` output line(s) from step 2 |

   Then delete the local private key copy.

4. **Public GHCR package.** After the first release pushes the image, the deploy fails until the package is public (the VPS pulls without logging in): GitHub → your profile → Packages → `nodbeat` → Package settings → Change visibility → Public. Also link it to the repository there if it isn't. Re-run the failed jobs.

### Cutting a release

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD` and update the compare links at the bottom.
2. Set `"version": "X.Y.Z"` in `package.json`.
3. Commit, then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. Watch the run in the Actions tab. `/health` then reports the new version.

Minor bump for features, patch for fixes; nodbeat stays `0.x`.

### Rolling back

Actions → **Release** → **Run workflow**, enter an earlier version (`0.10.0` or later; older ones have no image). It skips the build, checks the image exists, deploys it and waits for `/health` to report it. No GitHub Release is created.

By hand on the VPS, the same thing: `cd ~/nodbeat && git checkout vX.Y.Z`, set `NODBEAT_VERSION=X.Y.Z` in `.env`, `docker compose pull && docker compose up -d`.
