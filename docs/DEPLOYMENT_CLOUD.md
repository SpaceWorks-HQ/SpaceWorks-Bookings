# Deploying with managed services (cloud)

The cloud topology runs only the application processes, all from the backend image, and leaves the data to
managed services: PostgreSQL with TLS, Redis over TLS, an S3-compatible bucket and an SMTP relay. It mirrors
SpaceWorks' `docker-compose.cloud.yml` and `scripts/spaceworks-compose.sh cloud`.

## What you need

| Service | Examples | Notes |
|---|---|---|
| PostgreSQL 16 | Supabase, Neon, RDS, Cloud SQL | `sslmode=require` (or `verify-full`). Behind a transaction pooler (Supabase `:6543`) add `pgbouncer=true` to `DATABASE_URL` and give the direct or session URL as `DIRECT_URL` for migrations. |
| Redis 7 | Upstash, ElastiCache, Redis Cloud | Must be `rediss://` (TLS). It holds the job queues, so it needs persistence and `maxmemory-policy noeviction`. |
| Object storage | Cloudflare R2, Amazon S3, Backblaze B2 | A **private** bucket and a key limited to it. `S3_FORCE_PATH_STYLE=1` works with all of them. |
| SMTP | Brevo, Amazon SES, Postmark | A verified sending domain. |
| HTTPS | Your platform's load balancer, Cloudflare, or a reverse proxy | Terminates TLS in front of `APP_PORT` and overwrites the client-IP header named in `TRUSTED_PROXY_IP_HEADER`. |

### Harden the database connection

`sslmode=require` encrypts the connection but doesn't check who is at the other end. In production:

- **Verify the server.** Use `sslmode=verify-full` with your provider's CA (`sslrootcert=/path/to/ca.pem`, mounted
  read-only into the app, worker and beat containers). Supabase, Neon and RDS all publish their CA bundles.
- **Run the app as a data-only role.** Migrations need the schema owner; the running app doesn't. Create a second
  role with `CONNECT`, `USAGE` on the schema and `SELECT, INSERT, UPDATE, DELETE` on its tables (plus
  `USAGE, SELECT` on sequences and `ALTER DEFAULT PRIVILEGES` so new tables follow), put that role in
  `DATABASE_URL`, and keep the owner only in `DIRECT_URL`, which only the `migrate` role uses. This is how the
  bundled VPS stack runs (`swbook_app`), and it means a compromised app process can't alter the schema or the
  payment triggers.

## Docker host with Compose

```bash
git clone https://github.com/SpaceWorks-Labs/SpaceWorks-Bookings.git /opt/spaceworks-bookings
cd /opt/spaceworks-bookings
sudo install -D -m 600 .env.production.example /etc/spaceworks-bookings/cloud.env
sudoedit /etc/spaceworks-bookings/cloud.env      # fill every value; see docs/CONFIGURATION.md
export SWB_IMAGE_TAG=0.5.0-main.42.a1b2c3d4e5f6     # a published release, or latest
scripts/spaceworks-compose.sh cloud pull
scripts/spaceworks-compose.sh cloud up -d --wait
scripts/spaceworks-compose.sh cloud run --rm ops     # TLS, migrations, Redis, bucket, readiness
```

Generate the keys with `openssl rand -base64 32` (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`,
`PAYMENT_SECRETS_KEY`) and `openssl rand -base64 48` (`AUTH_SECRET`, `CRON_SECRET`, `HEALTHCHECK_SECRET`).
Keep an offline copy: without `MFA_ENCRYPTION_KEY` and `PAYMENT_SECRETS_KEY`, saved authenticator seeds and
gateway keys cannot be read. `SWB_STATIC_ENV_FILE` points the wrapper at another settings file.

| Service | Role |
|---|---|
| `migrate` | `--role migrate`: `prisma migrate deploy` on `DIRECT_URL` (falls back to `DATABASE_URL`), then exits |
| `backend` | `--role backend`: the app and API on `${APP_BIND:-127.0.0.1}:${APP_PORT:-8080}` |
| `worker` | `--role worker node dist/worker.js`: runs queued jobs (email delivery, payment and refund checks, retention); `/health` on port 3460 |
| `beat` | `--role beat node dist/beat.js`: keeps the job schedules in Redis; `/health` on port 3460 |
| `ops` (profile `tools`) | `--role ops`: operator checks on demand |

Block `/api/internal/*` at your edge; those endpoints also refuse any request without `CRON_SECRET`.

**Updating:** back up the database with your provider (point-in-time recovery or a snapshot), then set the new
`SWB_IMAGE_TAG` and run `pull` and `up -d --wait` again. `scripts/update.sh` is for the bundled topology.

## Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SpaceWorks-Labs/SpaceWorks-Bookings)

The button opens [`render.yaml`](../render.yaml), a Blueprint that creates, in one region (Singapore; change
`region` in every block to move it):

| Resource | Type | What it runs |
|---|---|---|
| `swbook-db` | Render PostgreSQL 16 | The database, with no public access (`ipAllowList: []`). |
| `swbook-backend` | Docker web service | The app and API, health check `/api/health`. Before each deploy Render runs `docker-entrypoint.sh --role migrate` in the new image (`preDeployCommand`); a failed migration stops the deploy. |
| `swbook-worker` | Docker background worker | `--role worker node dist/worker.js`: the BullMQ worker (email outbox, payment checks, retention). |
| `swbook-beat` | Docker background worker | `--role beat node dist/beat.js`: keeps the job schedules in Redis. |
| `swbook-shared` | Environment group | Generated secrets (`AUTH_SECRET`, `CRON_SECRET`, `HEALTHCHECK_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`, `PAYMENT_SECRETS_KEY`) and the fixed settings. |

All three services build the same Dockerfile (its last stage, `runner`). Render passes the service variables as
build arguments, so the generated `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and the public origin are compiled in and
match at run time.

**What Render asks for** when you create the Blueprint, once, on `swbook-backend` (the worker and beat read the
same values from it):

| Variable | Value |
|---|---|
| `REDIS_URL` | A TLS Redis, `rediss://…`, with `maxmemory-policy noeviction` (Upstash, Redis Cloud). Render Key Value's private URL is plain `redis://`, which the app refuses in production, so the Blueprint does not create one. |
| `SUPER_ADMIN_EMAIL` | The first super admin. |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | An SMTP relay on a verified sending domain (port 587 is preset). |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A private bucket and a key limited to it. Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com` (region `auto` is preset). |

**Database TLS:** Render hands out its private database URL without TLS parameters. The group sets
`DATABASE_URL_SSLMODE=require`, and the image's entrypoint adds `sslmode=require` to `DATABASE_URL` for every role.

**After the first deploy:**

1. Create the super admin in the `swbook-backend` Shell: `node docker/ops/admin.mjs create --email <address>`
   (it asks for the password). Super admins are only ever made on the server.
2. Open `https://<service>.onrender.com/login`. `NEXT_PUBLIC_BASE_URL` and `AUTH_URL` default to the service's
   own `RENDER_EXTERNAL_URL`.
3. For a custom domain, add it to `swbook-backend`, set `NEXT_PUBLIC_BASE_URL` and `AUTH_URL` there to
   `https://<domain>`, and redeploy the three services: the origin is compiled into the build.

The three keys are generated once and never change; keep an offline copy of `MFA_ENCRYPTION_KEY` and
`PAYMENT_SECRETS_KEY` (Dashboard → Environment groups). Back up the database with Render's own backups.

**Plans:** background workers and `preDeployCommand` need paid instance types (`starter` is preset). The worker
is not optional: it delivers every email, sign-in links included, and runs the timed jobs. The
`/api/internal/outbox` and `/api/internal/jobs` triggers only enqueue work for it, so a free web service on its
own is not enough. For a short trial without `preDeployCommand`, `MIGRATE_ON_START=1` on the web service applies
migrations at start instead.

**Private repository:** while `SpaceWorks-Labs/SpaceWorks-Bookings` is private, give Render's GitHub app access to it
(Render → Account settings → GitHub) before using the button.

## DigitalOcean App Platform

[`.do/app.yaml`](../.do/app.yaml) runs the published backend image as a web service, a `PRE_DEPLOY` migration
job, and the `worker` and `beat` workers, all with an explicit `docker-entrypoint.sh --role …`. Create a managed
PostgreSQL 16 cluster (`swbook-db`; its bound `${db.DATABASE_URL}` already has `sslmode=require`), a managed
Valkey cluster with `noeviction` (its `rediss://` URI goes into `REDIS_URL`), a private Spaces bucket and an SMTP
relay, replace every `CHANGE_ME` and `REPLACE_WITH_IMMUTABLE_RELEASE`, then
`doctl apps create --spec .do/app.yaml` and set the `SECRET` values in the control panel. While the GHCR
packages are private, add `registry_credentials` to each image block.

## Other platforms

Any container platform works with the published image:

- web: `ghcr.io/spaceworks-labs/spaceworks-bookings-backend:<version>` with the default command
  (`--role backend node server.js`) and the variables in [CONFIGURATION.md](CONFIGURATION.md). Where the
  platform replaces the image's entrypoint with your command, prefix it: `docker-entrypoint.sh --role …`;
- a release or pre-deploy job: the same image with `--role migrate`;
- two background services from the same image and variables, always: `--role worker node dist/worker.js`
  and `--role beat node dist/beat.js` (health on `JOBS_HEALTH_PORT`, 3460). The `/api/internal/*` triggers
  only enqueue work for the worker; they never replace it.

## Website on Netlify

Set `DEPLOYMENT_MODE=backend` and `FRONTEND_GATEWAY_SECRET` here, and `PUBLIC_APP_BASE_URL` to the website's
origin; see [DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md).
