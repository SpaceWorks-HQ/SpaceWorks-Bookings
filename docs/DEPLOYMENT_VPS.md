# Deploying on a server (VPS)

The bundled deployment runs the whole platform on one Linux server with Docker Compose, exactly like a
standalone SpaceWorks install: the curl installer, `setup.sh`, `scripts/update.sh` and
`scripts/spaceworks-compose.sh bundled`. Assume a dedicated server: the installer's Caddy takes ports 80 and 443.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Bookings/main/install.sh | bash
```

The installer checks the host (architecture, distribution, Docker, disk space, an existing install), asks which
GitHub repository to follow, downloads the newest published `main` release into temporary storage and asks the
deployment questions. Nothing changes until you confirm the summary. Then it installs missing packages (Docker
Engine, the Compose plugin, curl, tar), copies the release to `/opt/spaceworks-bookings` and runs `setup.sh`,
which:

1. writes the owner-only `.env` with every generated secret (`scripts/setup-write-environment.sh`):
   `AUTH_SECRET`, `CRON_SECRET`, `HEALTHCHECK_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`,
   `PAYMENT_SECRETS_KEY`, and the PostgreSQL, Redis and Silo passwords;
2. pulls the release images (or builds them with `bash setup.sh --build`);
3. creates a private CA and service certificates for PostgreSQL, Redis and Silo in `tls/`
   (`deploy/certificates.sh`, run inside the backend image so the host needs no openssl);
4. starts the stack with `up --wait` and runs the operator checks (`--role ops`), worker and beat included;
5. creates the super admin and installs the optional GitHub Actions runner.

The questions: run the website here or on Netlify; HTTPS (**1** plain HTTP for a LAN or trial, **2** automatic
HTTPS with the bundled Caddy and Let's Encrypt, **3** your own reverse proxy in front of `127.0.0.1:8080`); file
storage (**1** bundled Silo, **2** your own S3-compatible bucket such as R2); the super-admin email and password;
the SMTP relay; and the optional runner.

| Option | Environment | Effect |
|---|---|---|
| `--repo owner/name` | `SWB_REPOSITORY` | Install from a fork. |
| `--dir PATH` | `SWB_DIR` | Another install directory. |
| `--release TAG` | `SWB_RELEASE` | A published release instead of the latest. |
| `--ref REF` | `SWB_REF` | Build a branch, tag or commit from source on the server (no published images needed; about 4 GiB of memory). Updates rebuild the same ref. |
| `--action ACTION`, `--update` | `SWB_ACTION` | Run one menu entry on an existing install (below). |
| `--non-interactive`, `--yes` | `SWB_NONINTERACTIVE=1` | Never ask: the questions take `SWB_ANSWER_<KEY>` values (listed in [CONFIGURATION.md](CONFIGURATION.md#installer-installsh)). |
| `--dry-run` | `SWB_DRY_RUN=1` | Check the host and print the plan; from a checkout it also asks (or reads) the questions. Changes nothing. |

### Private repository

While the repository is private, `raw.githubusercontent.com` needs a token. Any of these works:

```bash
export GITHUB_TOKEN=<token with repo and read:packages>
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Bookings/main/install.sh | bash

gh auth login        # once, then:
gh api -H 'Accept: application/vnd.github.raw' repos/SpaceWorks-HQ/SpaceWorks-Bookings/contents/install.sh | bash

gh repo clone SpaceWorks-HQ/SpaceWorks-Bookings && bash SpaceWorks-Bookings/install.sh
```

The installer then uses `SWB_GITHUB_TOKEN`, `GITHUB_TOKEN` or `GH_TOKEN` (or, failing those, `gh auth token`) for
the release download, the updater and `docker login ghcr.io` before pulling the images. The token is passed to
curl and sudo by name only and is never written to `.env`; Docker keeps its own `ghcr.io` login for later pulls.
Until the first release is published, install a branch with `--ref main` (or `--ref dev`).

### Unattended installs (CI)

```bash
SWB_NONINTERACTIVE=1 SWB_ANSWER_HTTPS_MODE=2 SWB_ANSWER_PUBLIC_DOMAIN=book.example.org \
SWB_ANSWER_TLS_EMAIL=ops@example.org SWB_ANSWER_SUPER_ADMIN_EMAIL=admin@example.org \
SWB_ANSWER_SUPER_ADMIN_PASSWORD="$ADMIN_PASSWORD" SWB_ANSWER_SMTP_USER=relay \
SWB_ANSWER_SMTP_PASSWORD="$SMTP_PASSWORD" bash install.sh --ref main
```

A missing or invalid answer stops the run before anything changes and names the variable to set.

## Maintenance menu

Run the installer again (the same one-liner) on an installed server:

| # | Entry | `--action` | Script |
|---|---|---|---|
| 1 | Update | `update` | `scripts/update.sh --force` (or `--source <ref>` for a source install) |
| 2 | Check status | `status` | `scripts/status.sh`: release, address, services, backend, worker and beat health, disk, newest backup, then the operator checks |
| 3 | Back up now | `backup` | `scripts/backup.sh` |
| 4 | Backup settings | `backup-settings` | `scripts/backup-settings.sh`: how often backups run and how long scheduled dumps stay |
| 5 | Restore from a backup | `restore` | `scripts/restore.sh`: choose one of the newest dumps (and the files) |
| 6 | Roll back | `rollback` | `scripts/update.sh --force --rollback` |
| 7 | Change settings | `reconfigure` | `scripts/reconfigure.sh`: web address, outgoing email, external bucket keys |
| 8 | Server security | `harden` | `scripts/harden.sh`: firewall (ufw or firewalld; SSH, HTTP and HTTPS only), automatic security updates, fail2ban |
| 9 | Recover super-admin access | `recover-admin` | `scripts/recover-admin.sh`: remove a lost authenticator (`admin.sh reset-mfa`), set a new password, or create a super admin |
| 10 | Support bundle | `support` | `scripts/support-bundle.sh`: report and logs with secrets redacted, in `support/` |
| 11 | Automatic deploys | `runner`, `runner-remove` | `scripts/install-runner.sh [--remove]` |
| 12 | Uninstall | `uninstall` | `scripts/uninstall.sh`: keeps the data volumes and `.env`, `tls/`, `backups/` unless you type `DELETE DATA` |
| 0 | Cancel | `cancel` | |

Every script also runs on its own from the install directory, for example `bash scripts/status.sh`.

## What runs

`scripts/spaceworks-compose.sh bundled` always uses `docker-compose.prod.yml`, the install's `.env`, the
project name `swbook`, and the overlays the settings select:

| Setting in `.env` | Overlay | Effect |
|---|---|---|
| `SWB_LAYER='none'` | none | Caddy serves `http://<host>` on port 80 (plain HTTP, LAN or trial). |
| `SWB_LAYER='tls'` | `docker/compose.tls.yml` | Caddy obtains Let's Encrypt certificates and also serves 443 (TCP and QUIC). |
| `SWB_LAYER='proxy'` | `docker/compose.proxy.yml` | No Caddy; the app listens on `127.0.0.1:8080` for your proxy. |
| `SWB_STORAGE='external'` | `docker/compose.external-storage.yml` | No Silo; files go to the `S3_*` bucket. |
| `SWB_COMPOSE_BUILD_LAYER=1` (shell) | `docker/compose.build.yml` | Builds the backend image from the checkout. |

| Service | Image | Role |
|---|---|---|
| `db` | `postgres:16-alpine` | TLS only (`hostnossl … reject`), owner role `swbook`, runtime role `swbook_app` with data rights only |
| `redis` | `redis:7-alpine` | TLS only, password, append-only file, no eviction (it holds the job queues) |
| `minio` | `pgsty/silo` | TLS only, private bucket `spaceworks-bookings`, versioning on |
| `createbuckets` | `pgsty/silo` | Creates the bucket and the `swbook-app` identity limited to it, then exits |
| `migrate` | backend, `--role migrate` | `prisma migrate deploy` as the owner role, then exits |
| `backend` | backend, `--role backend` | The app and API (Next.js) as `swbook_app` |
| `worker` | backend, `--role worker` | BullMQ worker: email delivery, payment and refund checks, retention (`lib/scheduled/index.ts`); `/health` on 3460, ten minutes to finish on stop |
| `beat` | backend, `--role beat` | BullMQ beat: keeps the job schedules in Redis; `/health` on 3460 |
| `backup`, `backup-storage` | `postgres:16-alpine`, `pgsty/silo` | Scheduled database dumps and bucket mirror into `backups/` |
| `caddy` | `caddy:2-alpine` | The web edge; blocks `/api/internal/*`; overwrites `X-Real-IP` |
| `ops` (profile `tools`) | backend, `--role ops` | Operator checks, run on demand |

The data services sit on an internal network with no route to the internet. Only Caddy publishes ports.

```bash
scripts/spaceworks-compose.sh bundled ps
scripts/spaceworks-compose.sh bundled logs -f backend worker beat
scripts/spaceworks-compose.sh bundled run --rm ops      # TLS, roles, migrations, Redis, bucket, readiness, worker and beat
```

## Files on the server

| Path | Contents |
|---|---|
| `/opt/spaceworks-bookings/` | The installed release (compose files, `deploy/`, `scripts/`) |
| `.env` | Every setting and secret (mode 600). Back it up encrypted, off the server. |
| `tls/` | The private CA (`ca.key` never leaves this folder) and the service certificates |
| `backups/` | Database dumps, the bucket mirror, settings archives, replaced host files |
| `.spaceworks-version`, `.spaceworks-previous-version` | The running release and the one before it (`local` for a source build) |
| `.spaceworks-source-ref` | The branch, tag or commit a `--ref` install builds from |
| `support/` | Support bundles (owner-only) |

## Backups and restore

- **Scheduled:** the `backup` service dumps the database every `BACKUP_INTERVAL_HOURS` (24) to
  `backups/scheduled-<time>.sql.gz` and keeps `BACKUP_RETENTION_DAYS` (14); `backup-storage` mirrors the bucket
  to `backups/storage`.
- **On demand:** `bash scripts/backup.sh` (also the installer's menu option 3) writes a dump, refreshes the
  bucket mirror and archives `.env` and `tls/` to `backups/config-<time>.tar.gz`.
- **Before every update:** `backups/pre-update-<time>.sql.gz`.

Backups contain every secret. Copy them off the server, encrypted, for example
`tar -czf - backups | gpg --symmetric > swbook-backups.tar.gz.gpg`.

```bash
bash scripts/restore.sh backups/scheduled-20261020T020000Z.sql.gz                 # database only
bash scripts/restore.sh backups/manual-20261020T090000Z.sql.gz --with-storage     # and the files
```

Restore asks you to type `RESTORE`, takes a fresh `pre-restore` dump, stops the app, worker, beat and edge,
replaces the schema in one transaction, optionally copies the files back, and starts everything again;
migrations bring an older dump up to the running release.

**Restore on a new server:** install with the same answers, stop the stack, put the old `.env` and `tls/` back
from the settings archive (or from the `<install>.uninstalled-<time>` folder an uninstall leaves), start it, then
restore the dump (and `backups/storage` with `--with-storage`).

## Super admins

Super admins sign in with their email and password only. Their accounts and passwords are managed on the
server, never by email and never in the app:

```bash
bash scripts/admin.sh create --email you@example.org          # make (or promote) a super admin; asks for a password
bash scripts/admin.sh set-password --email you@example.org    # change a super admin's password; signs them out everywhere
bash scripts/admin.sh reset-mfa --email you@example.org       # remove an authenticator from a super-admin account
bash scripts/admin.sh revoke --email you@example.org          # take super-admin access away
bash scripts/admin.sh list
```

The installer creates the first one from the email and password you give, and every migrate run keeps the
`SUPER_ADMIN_EMAIL` account as super admin. Super admins cannot sign in with an emailed link. Without Docker
(`npm run admin -- …`) the same commands run against `DATABASE_URL`.

## Updates and rollback

```bash
bash scripts/update.sh --force                                   # newest main release
bash scripts/update.sh --force --version 0.5.0-main.42.a1b2c3d4e5f6
bash scripts/update.sh --rollback                                # the release before the last update
bash scripts/update.sh --force --source main                     # a --ref install: rebuild from that ref
```

The updater takes a lock (`flock`, or a PID lock on Git Bash; `--override-lock` clears a verified stale one),
resolves a published, non-prerelease `main` release, downloads its source and hands over to that release's own
updater. It dumps the database, checks the new image can be pulled, installs the release's host files (keeping
the old ones in `backups/host-config-*`), pulls the images, runs migrations and waits for every service to be
healthy, then runs the operator checks.

- **Source installs** (`install.sh --ref`): `--source <ref>` downloads the ref, backs up the database, copies the
  new tree over the install (the archive carries no `.env`, `tls/` or `backups/`), rebuilds the images on the
  server and restarts. There is no image rollback for a build; restore the pre-update dump instead.
- **Automatic rollback:** if the new release does not become healthy, the previous host files and images come
  back with `--no-deps`, so older migrations never run against the newer schema.
- **Manual rollback:** `--rollback` returns to the release recorded in `.spaceworks-previous-version`, again
  without running migrations. Database changes stay; to return the data too, restore the pre-update dump the
  command prints.

The installer menu offers both (options 1 and 6), and the release workflow's `deploy` job runs
`update.sh --force --version <release>` on a server with the runner (`scripts/install-runner.sh`).

## Certificates

The service certificates last 825 days. Renew them from the same CA, then recreate the data services:

```bash
docker run --rm --user "$(id -u):$(id -g)" --entrypoint sh -v "$PWD/tls:/tls" -v "$PWD/deploy/certificates.sh:/c.sh:ro" \
  "$(grep ^SWB_BACKEND_IMAGE= .env | cut -d"'" -f2):$(cat .spaceworks-version)" /c.sh --renew
scripts/spaceworks-compose.sh bundled up -d --force-recreate db redis minio backend
```

Caddy renews the public certificates by itself.

## Moving between modes

- **Plain HTTP to automatic HTTPS:** point DNS at the server, then in `.env` set `SWB_LAYER='tls'`,
  `SITE_ADDRESS='<domain>'`, `TLS_EMAIL='<you>'`, `PUBLIC_APP_BASE_URL='https://<domain>'` and remove
  `ALLOW_PLAIN_HTTP`, then `scripts/spaceworks-compose.sh bundled up -d`.
- **Website on Netlify:** set `DEPLOYMENT_MODE='backend'`, a 64-hex `FRONTEND_GATEWAY_SECRET` and
  `PUBLIC_APP_BASE_URL` to the website's origin; see [DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md).

## Troubleshooting

- `scripts/spaceworks-compose.sh bundled logs migrate` shows a failed migration; the app never starts on a
  half-migrated database.
- The worker and beat report healthy only while their Redis heartbeat is fresh; `logs worker beat` shows why
  one stopped, and Super admin → Jobs lists failed jobs to retry or remove.
- `run --rm ops` names the failing check without printing any connection detail.
