# Architecture

## Application

One Next.js 16 application (App Router, React Server Components, Server Actions) with Prisma 6 on
PostgreSQL 16. Makerspaces are tenants: every tenant row carries `makerspaceId`, every query is scoped
through the makerspace resolved for the request, and cross-tenant access returns 404. There is no database
row-level security; isolation is enforced in the application.

| Area | Where |
|---|---|
| Pages and Server Actions | `app/`, `components/`, `lib/views/` |
| Domain logic (memberships, money, receipts) | `lib/membership/`, `lib/money/` |
| Sign-in | Auth.js v5 (`lib/auth.ts`), email + password, authenticator MFA, Google, GitHub, Apple |
| Email | Nodemailer behind a database outbox (`lib/outbox.ts`) |
| Files | S3-compatible storage (`lib/storage/`), served through `/api/uploads/...` |
| Rate limits | Redis (`lib/rateLimit.ts`) |
| Start-up validation | `lib/env.ts`, called from `instrumentation.ts` |

### The scheduler pass

`runOutboxScheduler` in `lib/outboxWorker.ts` is the single place for periodic work. One pass runs the
membership sweep, delivers the email outbox, and purges expired operational data, then records a heartbeat.
Later phases add their jobs (payment reconciliation, reminders, report rollups) to the same pass.

It runs one of two ways, chosen by `SCHEDULER_MODE`:

- `in-process` (default): `instrumentation.ts` starts a one-minute timer inside each web process. Queue rows
  are claimed, so several processes are safe.
- `external`: the web process starts nothing; the `scheduler` role (`docker/ops/scheduler.mjs`) calls
  `POST /api/internal/outbox` with `CRON_SECRET` once a minute, one pass at a time, and reports healthy only
  after a successful pass. Every Compose stack and the Render Blueprint use this.

## Images and roles

Two images come from the one `Dockerfile` and are published to GHCR by `.github/workflows/release.yml`:

| Image | Target | Roles (`scripts/docker-entrypoint.sh --role …`) |
|---|---|---|
| `spaceworks-bookings-backend` | `runner` | `backend` (web app and API), `migrate` (`prisma migrate deploy`), `scheduler`, `ops` (operator checks) |
| `spaceworks-bookings-frontend` | `frontend` | `frontend`: the website alone for split hosting (the `frontend/` workspace) |

Release images are identical for every installation. The public origins compiled into Next.js are placeholders
(`spaceworks-bookings-origin.invalid`, `spaceworks-bookings-backend.invalid`) that the entrypoint
replaces at start from `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_BACKEND_ORIGIN`. The Server Actions key used to
build is a throwaway; web roles refuse to start without the installation's own key. PostgreSQL, Redis, Silo and
Caddy run from their own upstream images.

## Deployment topologies

```
Bundled (docker-compose.prod.yml)                       Cloud (docker-compose.cloud.yml)

 internet ── caddy :80/:443 ──┐  edge network            platform TLS ── backend :8080
                              ▼                                          │
            backend ◄── scheduler                           scheduler ───┘
               │  (TLS, private CA)    data network          migrate (one-shot)
   ┌───────────┼───────────┐  (internal, no egress)              │
   db        redis       minio ◄─ createbuckets             managed PostgreSQL, Redis (TLS),
   ▲ migrate (owner role)  ▲ backup-storage                 S3/R2 bucket, SMTP relay
   └ backup (pg_dump)
```

- **Bundled:** everything on one server through `scripts/spaceworks-compose.sh bundled`, with overlays for
  automatic HTTPS (`docker/compose.tls.yml`), an existing proxy (`docker/compose.proxy.yml`), an external
  bucket (`docker/compose.external-storage.yml`) and source builds (`docker/compose.build.yml`).
  PostgreSQL, Redis and Silo accept TLS only, with certificates from the install's private CA
  (`deploy/certificates.sh`). Migrations run as the owner role `swbook`; the app runs as `swbook_app`, which can
  read and write data but cannot change the schema or roles.
- **Cloud:** the backend image's roles on any Docker host (`scripts/spaceworks-compose.sh cloud`) or on Render
  (`render.yaml`), with managed services.
- **Split:** the website on Netlify (or the frontend image) and the backend in either topology above; the
  website reaches the backend only through the signed gateway (`frontend/catalog.json`,
  `FRONTEND_GATEWAY_SECRET`). See [DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md).

## Releases

`VERSION` selects the series. Every push to `main` runs the tests, publishes both images (amd64 and arm64)
tagged `<VERSION>-main.<run>.<sha>` and `sha-<sha>`, creates a GitHub release with that tag, promotes the
images to `latest`, `main` and the series, prunes superseded image versions (keeping the previous release for
rollback) and, with `SWB_DEPLOY=true`, deploys through a self-hosted runner. Pushes to `dev` publish images
tagged `dev` and `<VERSION>-dev.<run>.<sha>` only. The installer and updater accept only published,
non-prerelease `main` releases.
