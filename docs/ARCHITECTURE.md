# Architecture

## Application

One Next.js 16 application (App Router, React Server Components, Server Actions) with Prisma 6 on
PostgreSQL 16. Makerspaces are tenants: every tenant row carries `makerspaceId`, every query is scoped
through the makerspace resolved for the request, and cross-tenant access returns 404. There is no database
row-level security; isolation is enforced in the application.

| Area | Where |
|---|---|
| Pages and Server Actions | `app/`, `components/`, `lib/views/` (one loader per page, also the split website's catalogue) |
| Tenancy, team and roles | `lib/makerspaces.ts`, `lib/makerspaceLifecycle.ts`, `lib/permissions.ts`, `lib/permissionRoles.ts` |
| Money, receipts and tax | `lib/payments/*`, `lib/money/` (see [PAYMENTS.md](PAYMENTS.md) and [GST.md](GST.md)) |
| Sign-in | Auth.js v5 (`lib/auth.ts`): email and password, emailed sign-in link (`lib/magicLink.ts`), authenticator MFA. No single sign-on |
| Email and chat | Nodemailer and chat providers behind a database outbox (`lib/outbox.ts`, `lib/outboxKinds.ts`, `lib/chat/*`) |
| Background jobs | BullMQ on Redis (`lib/queue/*`, `lib/scheduled/index.ts`, `scripts/queue/*`) |
| Files | S3-compatible storage (`lib/storage/`), served through `/api/uploads/...` |
| Rate limits and address blocks | Redis (`lib/rateLimit.ts`, `lib/ipBlock.ts`) |
| Start-up validation | `lib/env.ts`, called from `instrumentation.ts` and the job processes |

Public pages: the landing page, `/makerspaces` (listed makerspaces) and `/m/[makerspaceSlug]`, a minimal
page with the makerspace's name, logo, description and contact details. Phase 1 adds its spaces and booking.

### Roles

`TeamRole` is `OWNER`, `SPACE_MANAGER`, `BOOKINGS_MANAGER`, `FRONT_DESK`, `TREASURER` or `VIEWER`.
`CAPABILITIES` in `lib/permissionRoles.ts` maps each capability (`makerspace.settings`, `team.manage`,
`payments.settings`, `spaces.manage`, `bookings.manage`, `payments.record`, `refunds.manage`,
`reports.finance` and the rest) to the roles that hold it. Pages use `requireMakerspaceCapability`, actions
`makerspaceActionAccess`. A suspended or archived makerspace keeps only viewing and finishing money already
received. Owners manage everyone; space managers manage less senior roles.

## Background jobs

Two long-running processes share the backend image and Redis:

- **worker** (`node dist/worker.js`) runs jobs from the `outbox` and `scheduled` queues
  (`lib/queue/worker.ts`). Outbox jobs carry only a row id; SQL stays the durable outbox and owns retry timing.
  BullMQ keeps failed jobs for up to 30 days as the dead-letter store.
- **beat** (`node dist/beat.js`) turns the registry into BullMQ job schedulers once per start
  (`lib/queue/beat.ts`), removing schedulers whose entry is gone. Several beats are safe.

Both serve `GET /health` on `JOBS_HEALTH_PORT` (3460) while their Redis heartbeat is fresh, and stop
gracefully on `SIGTERM`. `scripts/build-jobs.mjs` (`npm run build:jobs`) bundles them with esbuild; the
Dockerfile runs it and copies `dist/` into the image.

The registry is `SCHEDULED_JOBS` in `lib/scheduled/index.ts`:

| Job | Queue | Schedule | Work |
|---|---|---|---|
| `outbox-relay` | outbox | every 5 s | enqueue due outbox rows by id |
| `payments-reconcile` | scheduled | every 5 min | ask the gateway about open checkout attempts |
| `refunds-reconcile` | scheduled | every 5 min | ask the gateway about pending gateway refunds |
| `operational-retention` | scheduled | daily 00:00 UTC | purge expired tokens, invites and old outbox rows |
| `heartbeat` | scheduled | every minute | record that the jobs run (Super admin → Operations) |

To add a job, write `lib/scheduled/<area>.ts` exporting `run(now)` and add `{ area, run }` to the registry,
optionally with `queue` and `schedule: { every: ms }` or `{ pattern: "<cron>", tz }` (the default is the
`scheduled` queue every minute). The next deploy's beat creates its scheduler.

For hosts that cannot run the worker and beat all the time, `POST /api/internal/outbox` and
`POST /api/internal/jobs` with `Authorization: Bearer $CRON_SECRET` enqueue the same work; they never run it
inline. In development without Redis, `JOBS_INPROCESS=true` runs every job inside `npm run dev` once a minute
(`lib/outboxWorker.ts`). Super admin → Jobs (`/super-admin/jobs`) shows queue counts and recent failures and
can pause, resume, retry or remove, each change audited.

## Images and roles

Two images come from the one `Dockerfile` and are published to GHCR by `.github/workflows/release.yml`:

| Image | Target | Roles (`scripts/docker-entrypoint.sh --role …`) |
|---|---|---|
| `spaceworks-bookings-backend` | `runner` | `backend` (web app and API), `migrate` (`prisma migrate deploy`), `worker`, `beat`, `ops` (operator checks) |
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
                              ▼                          worker, beat (BullMQ)
            backend   worker   beat                      migrate (one-shot)
               │  (TLS, private CA)    data network            │
   ┌───────────┼───────────┐  (internal, no egress)     managed PostgreSQL, Redis (TLS),
   db        redis       minio ◄─ createbuckets          S3/R2 bucket, SMTP relay
   ▲ migrate (owner role)  ▲ backup-storage
   └ backup (pg_dump)
```

- **Bundled:** everything on one server through `scripts/spaceworks-compose.sh bundled`, with overlays for
  automatic HTTPS (`docker/compose.tls.yml`), an existing proxy (`docker/compose.proxy.yml`), an external
  bucket (`docker/compose.external-storage.yml`) and source builds (`docker/compose.build.yml`).
  PostgreSQL, Redis and Silo accept TLS only, with certificates from the install's private CA
  (`deploy/certificates.sh`). Migrations run as the owner role `swbook`; the app, worker and beat run as
  `swbook_app`, which can read and write data but cannot change the schema or roles.
- **Cloud:** the backend image's roles on any Docker host (`scripts/spaceworks-compose.sh cloud`) or on Render
  (`render.yaml`: `swbook-backend`, `swbook-worker`, `swbook-beat`), with managed services.
- **Split:** the website on Netlify (or the frontend image) and the backend in either topology above; the
  website reaches the backend only through the signed gateway (`frontend/catalog.json`,
  `FRONTEND_GATEWAY_SECRET`). See [DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md).

## Database

One baseline migration, `prisma/migrations/0001_init`, creates the schema and adds what Prisma cannot
express: CHECK constraints, partial unique indexes and the triggers that keep money rows immutable
(`Payment`, `PaymentLine`, `Refund`, `TaxDocument`). Later phases add migrations on top.

## Reports

The report pages are not built yet (Phase 3). What remains are pure, unit-tested helpers for them:
`lib/reports/period.ts` (financial-year periods and buckets in the makerspace's timezone),
`lib/reports/money.ts` (totals per currency, never added across currencies), `lib/reports/chartScale.ts`,
`lib/reports/mask.ts` (contact masking for roles without `bookings.contact`), `lib/reports/exports/stream.ts`
(audited CSV streams) and `lib/reports/finance/*` (revenue, GSTR-1 and GSTR-3B, the documents register),
plus the chart components in `components/reports/charts/`.

## Releases

`VERSION` selects the series. Every push to `main` runs the tests, publishes both images (amd64 and arm64)
tagged `<VERSION>-main.<run>.<sha>` and `sha-<sha>`, creates a GitHub release with that tag, promotes the
images to `latest`, `main` and the series, prunes superseded image versions (keeping the previous release for
rollback) and, with `SWB_DEPLOY=true`, deploys through a self-hosted runner. Pushes to `dev` publish images
tagged `dev` and `<VERSION>-dev.<run>.<sha>` only. The installer and updater accept only published,
non-prerelease `main` releases.
