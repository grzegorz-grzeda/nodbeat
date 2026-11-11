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
3. Optionally set the description (`/setdescription`). The command menu is set by nodbeat at startup.
4. Generate a webhook secret for `TELEGRAM_WEBHOOK_SECRET`: `openssl rand -hex 32` (Telegram allows `A-Z a-z 0-9 _ -` only).

There's no need to call `setWebhook` or `setMyCommands` yourself: at every startup nodbeat registers `PUBLIC_BASE_URL/telegram/webhook` with that secret (receiving only `message` and `my_chat_member` updates) and sets the command menu (`start`, `status`, `unlink`). A failure is logged and doesn't stop startup.

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

nodbeat believes `X-Forwarded-For` only from the edge Caddy, recognised by a fixed IP; anything else on the `edge` network is limited and logged by its own address. So in the edge repo, give the `edge` network a fixed subnet and Caddy a fixed address in it (in its `compose.yaml`):

```yaml
services:
  caddy:
    networks:
      edge:
        ipv4_address: 172.30.0.10

networks:
  edge:
    name: edge
    ipam:
      config:
        - subnet: 172.30.0.0/24
```

Pick a subnet that no other Docker network on the VPS uses (`docker network inspect $(docker network ls -q) | grep Subnet`). An existing `edge` network without that subnet must be recreated: stop every project on it, `docker network rm edge`, then bring the edge project up first. Check with `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <caddy-container>`. This address goes into `TRUSTED_PROXY_IP` in step 5. Keep the `edge` network IPv4-only: with IPv6 enabled Caddy may connect from an untrusted IPv6 address, and every visitor would then share one login limit.

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

| Variable                  | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `MONGODB_URI`             | the string from step 1                                      |
| `PUBLIC_BASE_URL`         | `https://nodbeat.g2labs.pl`                                 |
| `SESSION_SECRET`          | `openssl rand -base64 48`                                   |
| `TELEGRAM_BOT_TOKEN`      | from step 2                                                 |
| `TELEGRAM_WEBHOOK_SECRET` | from step 2                                                 |
| `TRUSTED_PROXY_IP`        | the edge Caddy's fixed IP from step 4 (e.g. `172.30.0.10`)  |
| `SELF_HEARTBEAT_URL`      | from step 9 (leave empty for now; set it and restart then)  |
| `LEGAL_DIR`               | `/legal` once step 10's files exist (empty: no legal pages) |

## 6. Start

`compose.yaml` runs the prebuilt image `ghcr.io/grzegorz-grzeda/nodbeat:latest` (ADR 0006); nothing is built on the VPS and `.env` names no version.

```sh
docker compose pull
docker compose up -d
docker compose logs -f nodbeat
```

nodbeat prints every configuration problem and exits if `.env` is wrong. Once it listens, `https://nodbeat.g2labs.pl/health` answers `{"status":"ok","version":"X.Y.Z","commit":"<sha>"}`.

Then add the daily update (`crontab -e`). Cron uses the VPS's time zone:

```cron
0 3 * * * ~/nodbeat/scripts/update.sh >> ~/nodbeat-update.log 2>&1
```

`scripts/update.sh` pulls `:latest`, recreates the container only if the image changed and removes the image it replaced. Run it by hand to take a release live straight away.

## 7. Admin User

There is no registration. Create the Admin from the CLI; the password is read from stdin and never lands in shell history:

```sh
docker compose exec -it nodbeat node dist/cli-main.js create-user --email you@example.com --admin --time-zone Europe/Warsaw
```

Log in at `https://nodbeat.g2labs.pl`.

## 8. Nightly backup

M0 has no automated backups. `scripts/backup.sh` runs `mongodump` without the raw `heartbeats` collection (they expire after 7 days anyway), encrypts the gzipped archive with [`age`](https://age-encryption.org) and streams it to Google Drive with `rclone` as `nodbeat-<UTC time>.archive.gz.age`, removing its own archives older than 30 days. No plaintext archive touches the VPS disk, and Google Drive only ever holds ciphertext. The VPS holds only the public key, so it can write backups but not read them.

**Key pair, off the VPS.** On your own machine (not the VPS), install `age` and generate the key:

```sh
age-keygen -o nodbeat-backup-key.txt
```

It prints the public key (`Public key: age1...`). Keep `nodbeat-backup-key.txt` (the private key) somewhere safe off the VPS, e.g. a password manager, plus an offline copy: without it no backup can be restored.

On the VPS host:

1. Install the [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/installation/) (`mongodump`), `age` (`sudo apt install age`) and [rclone](https://rclone.org/install/).
2. Put only the public key into `~/nodbeat/.env`: `BACKUP_AGE_RECIPIENT=age1...`. The script refuses to run without it.
3. `rclone config` → new remote named `gdrive`, type _Google Drive_, scope `drive.file`. On a headless VPS, use the `rclone authorize "drive"` flow from a machine with a browser.
4. Try it once: `~/nodbeat/scripts/backup.sh`, then `rclone ls gdrive:nodbeat-backups`.
5. `crontab -e`:

   ```cron
   30 3 * * * ~/nodbeat/scripts/backup.sh >> ~/nodbeat-backup.log 2>&1
   ```

The script reads `MONGODB_URI` and `BACKUP_AGE_RECIPIENT` from `~/nodbeat/.env` unless they are set in the environment. Override with env vars: `RCLONE_REMOTE` (default `gdrive:nodbeat-backups`), `RETENTION_DAYS` (default `30`), `ENV_FILE`. The upload goes to `partial-<name>` first and is renamed only when the whole pipeline succeeded; a failed run removes it.

To restore, on a machine that has the private key:

```sh
rclone copy gdrive:nodbeat-backups/<file> .
age -d -i nodbeat-backup-key.txt <file> | mongorestore --uri="$MONGODB_URI" --archive --gzip --drop
```

**Upgrading from unencrypted backups.** Older backups are named `nodbeat-*.archive.gz` (no `.age`) and are no longer removed by retention. Delete them once the first encrypted backup is in place: `rclone delete gdrive:nodbeat-backups --include "nodbeat-*.archive.gz"`.

Optionally signal a second healthchecks.io check at the end of the cron line (`&& curl -fsS -m 10 --retry 3 <check-url>`) so a silently failing backup gets noticed.

## 9. External self-Heartbeat

nodbeat can't alert about its own death, so something outside must watch it.

1. On [healthchecks.io](https://healthchecks.io), create a check named `nodbeat`: period **1 minute**, grace **3 minutes**. Add an email (or other) integration that doesn't depend on nodbeat.
2. Copy the check's URL into `SELF_HEARTBEAT_URL` in `.env`.
3. `docker compose up -d` to restart with it.

nodbeat sends a GET to that URL at startup and every 60 s. Failures are only logged. Within a minute the check should turn green.

## 10. Terms and Privacy policy (spec 0014, ADR 0008)

The Operator writes the legal text; it isn't in the repo or the image. `compose.yaml` mounts `~/nodbeat/legal` read-only at `/legal` (`legal/` is git- and docker-ignored). Put three files there:

- `terms.md` and `privacy.md`, each starting with front-matter:

  ```markdown
  ---
  version: 2026-12-01
  summary: One line on what changed, shown when Users are asked to accept it.
  ---

  # Terms
  ```

  `version` is a date (`YYYY-MM-DD`); bump it when the text changes. The body may use `#` headings, paragraphs, `-` or `1.` lists and `[text](https://...)` links; anything else (bold, raw HTML) shows as plain text.

- `operator.md`, front-matter only:

  ```markdown
  ---
  name: Your Name or Company
  nip: "0000000000"
  address: ul. Example 1, 00-000 Warszawa
  email: contact@example.com
  ---
  ```

Set `LEGAL_DIR=/legal` in `.env` and `docker compose up -d`. `/terms` (starting with the Operator's details) and `/privacy` appear, and every page's footer links to both and names the Operator. The files are read at startup: restart after editing them. A malformed file stops startup with its name in the error. With `LEGAL_DIR` unset or any of the three files missing, there are no legal pages, footer links or Operator details (a self-hosted instance without its own).

## 11. Releases (ADR 0005, ADR 0006)

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`:

1. checks the tag matches the `package.json` version and that `CHANGELOG.md` has a `## [X.Y.Z]` section;
2. runs typecheck, tests and lint;
3. builds the image with `APP_VERSION` / `APP_COMMIT` baked in and pushes it as `ghcr.io/grzegorz-grzeda/nodbeat:X.Y.Z` and `:latest`;
4. creates the GitHub Release `vX.Y.Z` with that `CHANGELOG.md` section as its notes.

GitHub never connects to the VPS. The release goes live at the next 03:00 run of `scripts/update.sh` (step 6), or straight away if you run it by hand. The workflow doesn't check that it started: the external self-Heartbeat (step 9) catches a release that doesn't come up.

`.github/workflows/ci.yml` runs typecheck, tests and lint on every push to `main`.

### One-time setup

**Public GHCR package.** The VPS pulls without logging in, so the package must be public: GitHub → your profile → Packages → `nodbeat` → Package settings → Change visibility → Public. Also link it to the repository there if it isn't.

### Cutting a release

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD` and update the compare links at the bottom.
2. Set `"version": "X.Y.Z"` in `package.json`.
3. Commit, then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. Watch the run in the Actions tab. After 03:00 (or `~/nodbeat/scripts/update.sh`), `/health` reports the new version.

Minor bump for features, patch for fixes; nodbeat stays `0.x`. Tag in order: `:latest` follows the last tag pushed, so a patch to an older line would move it backwards.

### Rolling back

Actions → **Release** → **Run workflow**, enter an earlier version (`0.10.0` or later; older ones have no image). It points `:latest` at that image; nothing is built and no GitHub Release is created. Then run `~/nodbeat/scripts/update.sh` on the VPS, or wait for 03:00.

### `compose.yaml` and scripts

The daily job updates only the image. When `compose.yaml` or `scripts/` change, run `git pull` in `~/nodbeat`, then `scripts/update.sh`.

### Switching from the SSH deploy (before ADR 0006)

1. Create `:latest` once: Actions → **Release** → **Run workflow** with the version now running (e.g. `0.12.0`).
2. On the VPS: `cd ~/nodbeat && git checkout main && git pull`, delete the `NODBEAT_VERSION=` line from `.env`, run `scripts/update.sh`, add the cron line from step 6.
3. Remove the deploy key's line from `~/.ssh/authorized_keys`.
4. Delete the GitHub secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` and `VPS_KNOWN_HOSTS`.
