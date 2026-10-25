# SpaceWorks-Bookings: ops porting guide (survey of W / O / E)

Repos surveyed (read-only, at these heads):

| Key | Repo | Version | HEAD |
|---|---|---|---|
| W | SpaceWorks-Workspace | 0.6.6 | f6f0210 |
| O | SpaceWorks-Organization | 0.7.0 | bc71613 |
| E | SpaceWorks-Events | 0.10.0 | 9a68c45 |

In this guide, `ref/` means `/private/tmp/claude-501/-Users-shaanshoukath-Documents-TInkerspace/570ee526-1161-4b9a-946f-a26b3388c341/scratchpad/ref/`.

**Short answer:** start from O for the app (auth, multi-tenant, payments, tests). For the requirement list ("BullMQ worker + beat, backend + frontend GHCR images, curl install.sh with menu, VPS compose, render.yaml"), take W's ops layer: its queue code, compose, installer, scripts and release flow. W already does all of this. O does not run BullMQ and has no frontend container in its VPS compose. E copies W's ops layer, but its "worker"/"beat" are not BullMQ (see 2.2).

---

## 1. W's BullMQ implementation

### 1.1 Files

| File | Lines | Role |
|---|---|---|
| `lib/queue/definitions.ts` | 37 | Pure, no `server-only`. `QUEUE_NAMES = ["outbox","scheduled","sync","monitor","documents"]`, the `QueueJob` union (`secrets-rotation`, `google-meet`, `registered{area}`, `outbox{outboxId}`), `JobDefinition {area, queue?, schedule?, run(now)}`, `RepeatSchedule = {every} \| {pattern, tz?}`. `JOB_OPTIONS`: attempts 8, exponential backoff 5s, removeOnComplete 1d/2000, removeOnFail 30d/5000 (the failed set doubles as the dead-letter store), stackTraceLimit 0. Also `queueConcurrency(name)` (env `QUEUE_<NAME>_CONCURRENCY`, 1..64; defaults 5/2/2/1/1), `jobId(kind,key)` (sha256, no `:` separators) and `scheduleDefinitions()` (rejects duplicate areas and intervals under 1s; default `{every: 60_000}`; scheduler id `registry-<area>`). |
| `lib/queue/client.ts` | 51 | `queueConnection(blocking, url)` parses `REDIS_URL` into ioredis options (`rediss:` gives `tls:{}`; blocking clients get `maxRetriesPerRequest:null` and retry forever; request clients get 1 retry and fail fast). `createQueues(prefix="sww:jobs")` and a `getQueues()` singleton on `Symbol.for("sww.queues")`, which drops itself on error so the next request reconnects. `closeQueues()`. |
| `lib/queue/enqueue.ts` | 32 | `enqueueDueOutbox()`: SQL outbox rows that are PENDING and due, or PROCESSING and stale for over 15 min (100 per call) go to the `outbox` queue via `addBulk` with `jobId("outbox", id)` for dedupe. Redis only carries ids. `enqueueScheduledTick()`: the compatibility path for external cron; it enqueues every registry job with a time-bucket jobId (cron via `cron-parser`). |
| `lib/queue/beat.ts` | 20 | `syncSchedules()`: `upsertJobScheduler(id, schedule, {name, data, opts})` for each definition, then removes stale `registry-*` schedulers. Idempotent, so several beats are safe. |
| `lib/queue/worker.ts` | 63 | `processQueueJob(job, token)`: dispatches by `kind`. For `outbox` it runs `deliverOutboxBatch(1,{ids:[id]})`, then re-reads the row. SENT completes the job; FAILED throws `UnrecoverableError`; not yet due calls `job.moveToDelayed(due)` and throws `DelayedError`, so SQL owns retry timing. `createWorkers()` starts one `Worker` per queue (`concurrency`, `maxStalledCount:2`) and runs errors through `describeOperationalError` (lib/redactSensitiveText) so BullMQ never stores secrets. |
| `lib/queue/admin.ts` | 40 | `getJobsHealth()`: a safe projection of counts and the last 10 failures. `manageQueue({queue, operation: pause\|resume\|retry\|remove, jobId})`. Retrying an outbox job resets the SQL row FAILED to PENDING. |
| `lib/scheduled/index.ts` | 86 | **The registry.** `SCHEDULED_JOBS: JobDefinition[]`, one entry per area (`{ area: "x", queue?: "sync", schedule?: {every}\|{pattern,tz}, run }`), each importing `run` from `lib/scheduled/<area>.ts` (around 32 area files). Three infra entries matter for you: `monitor-checks` (5s), `outbox-relay` (queue outbox, every 5s, calls `enqueueDueOutbox`) and `operational-retention` (cron `0 0 * * *` UTC, `purgeExpiredOperationalData`). `runScheduledJobs()` is the Redis-free fallback that runs everything inline. |
| `scripts/queue/runtime.ts` | 54 | Shared process shell `runProcess(role, start)`: calls `validateRuntimeEnvironment()` and `getQueues(true)`; heartbeats a Redis key `sww:jobs:heartbeat:<role>:<host>:<pid>` (EX 45, every 10s); serves an HTTP `/health` on `JOBS_HEALTH_PORT` (default 3460; returns 200 if a heartbeat succeeded in the last 30s); on SIGTERM/SIGINT closes workers, queues and Prisma gracefully. |
| `scripts/queue/worker.ts` | 10 | `runProcess("worker", createWorkers …)`. Health means every worker is running and its client is `ready`. |
| `scripts/queue/beat.ts` | 7 | `runProcess("beat", syncSchedules)`. Beat only reconciles schedulers once per start; BullMQ itself produces the repeats. |
| `scripts/build-jobs.mjs` | 22 | esbuild bundles `scripts/queue/{worker,beat}.ts` into `dist/worker.js` and `dist/beat.js` (cjs, node22). `@prisma/client` and `sharp` stay external. `server-only` resolves to empty. `next/headers` and `next/navigation` are stubbed to throw "unavailable outside a request", because Next standalone tracing omits worker-only imports. |
| `scripts/scheduler.mjs` | 13 | Managed-host fallback: POSTs `/api/internal/outbox` and `/api/internal/jobs` with `Bearer CRON_SECRET` every 60s. |
| `app/api/internal/jobs/route.ts` | — | POST plus bearer `CRON_SECRET` calls `enqueueScheduledTick()`; returns 204, or 404 without the bearer and 503 when Redis is down. |
| `app/api/internal/outbox/route.ts` | — | POST plus bearer calls `enqueueDueOutbox()`. Enqueue only; never delivers inline. |
| `app/actions/jobs.ts`, `app/admin/jobs/page.tsx`, `components/admin/JobsPanel.tsx`, `lib/views/generated/admin-jobs-page-loadAdminJobsPage.ts` | — | Super-admin Jobs page, gated by `requireSuperAdminMfa()`, rate-limited and audited (`admin.jobs_<op>`). |
| `instrumentation.ts` | — | Starts the in-process `startOutboxWorker()` only when `NODE_ENV!=="production" && !REDIS_URL && JOBS_INPROCESS==="true"` (dev without Redis). |
| `lib/outboxWorker.ts` | — | The same guard; dev-only polling. |
| `deploy/cloudflare-cron/` | — | Wrangler worker that hits `/api/internal/{outbox,jobs}` for free-tier hosts. |

Other producers call `getQueues()` directly with a stable `jobId`, and fall back to inline execution when `REDIS_URL` is unset: `lib/secrets/rotation.ts` (`enqueueRotation`) and `lib/calendar/google/meet-links.ts` (`enqueueMeetLink`).

### 1.2 Defining and scheduling a job

1. Write `lib/scheduled/<area>.ts` exporting `async function run(now: Date)`.
2. Add `{ area: "<area>", run }` to `SCHEDULED_JOBS`. Optionally add `queue: "sync"|"monitor"|"documents"|"outbox"` and `schedule: {every: ms}` or `{pattern: "cron", tz}`. The default is the `scheduled` queue, every 60s.
3. On deploy, `beat` upserts a BullMQ job scheduler `registry-<area>` and deletes removed ones. `worker` receives `{kind:"registered", area}` and calls `definition.run(new Date())`. A missing area raises `UnrecoverableError`.
4. For an ad-hoc job, add a new `kind` to the `QueueJob` union and a branch in `processQueueJob`, then `getQueues().<queue>.add(name, data, { jobId: jobId(kind, key) })`.

### 1.3 Dependencies (W package.json and lock)

- `bullmq` **5.81.5** (exact). Its nested deps are `ioredis` 5.11.1, `cron-parser` 4.9.0 and `msgpackr` 2.0.5.
- `ioredis` `^6.0.0` (6.0.0 locked; used by the app's own rate-limit client `lib/redis.ts`).
- `cron-parser` `^5.10.2` (used by `enqueueScheduledTick`).
- devDep `esbuild` **0.28.2**, for `build:jobs`.
- npm scripts: `"build:jobs": "node scripts/build-jobs.mjs"`, `"worker": "node --env-file-if-exists=.env dist/worker.js"`, `"beat": "node --env-file-if-exists=.env dist/beat.js"`. `npm run build:jobs` also runs inside the Dockerfile `builder` stage (`RUN npx prisma generate && npm run build:jobs`).

O already has `ioredis` 6.0.0. Add `bullmq@5.81.5`, `cron-parser@^5.10.2` and `esbuild@0.28.2` (dev).

### 1.4 Environment variables

| Var | Where | Notes |
|---|---|---|
| `REDIS_URL` | app, worker, beat | Required in production; `lib/env.ts` enforces `rediss://` in production. The Redis server needs `appendonly yes` and `maxmemory-policy noeviction`. Both W `docker/vps/setup.mjs` (redis.conf) and O `deploy/redis-start.sh` already set them. |
| `JOBS_QUEUE_PREFIX` | optional | Default `sww:jobs`. Rename it (for example `swb:jobs`). Tests set a unique prefix per run. |
| `QUEUE_{OUTBOX,SCHEDULED,SYNC,MONITOR,DOCUMENTS}_CONCURRENCY` | worker | 1..64. |
| `JOBS_HEALTH_PORT` | worker, beat | Default 3460. |
| `JOBS_INPROCESS` | dev only | `"true"` runs the in-process outbox without Redis. |
| `CRON_SECRET` | app | Bearer secret for `/api/internal/{jobs,outbox}`. |
| `TEST_QUEUE_REDIS_URL` | tests | Default `redis://127.0.0.1:6395/0`; CI sets `redis://127.0.0.1:6379/0`. |

### 1.5 How W runs it

- **Dockerfile:** `builder` runs `npm run build:jobs`; `runner` does `COPY --from=builder /app/dist ./dist`. No separate image: worker and beat are commands on the backend image.
- **Entrypoint** (`scripts/docker-entrypoint.sh`): `node dist/worker.js` and `node dist/beat.js` match the "operator tool" case, so they skip origin rewriting and the `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` check.
- **compose.production.yml:** `worker` and `beat` services, `<<: *backend`, `command: ["node","dist/worker.js"]` and `["node","dist/beat.js"]`, `stop_grace_period: 10m`, `MIGRATE_ON_START: "0"`, `JOBS_HEALTH_PORT: "3460"`. Healthcheck is `fetch('http://127.0.0.1:3460/health')`. They depend on postgres and redis being healthy and on `migrator` having completed, and sit on networks `[edge, data]` (edge for outbound SMTP and APIs).
- **docker/vps/check.mjs** probes `http://worker:3460/health` and `http://beat:3460/health`.
- **render.yaml:** `type: worker` services `spaceworks-workspace-worker` (`dockerCommand: node dist/worker.js`) and `spaceworks-workspace-beat` (`node dist/beat.js`), plan `0.5c-512mb`. Their env comes from the web service via `fromService`. The web service has `preDeployCommand: docker-entrypoint.sh migrate`.

### 1.6 Tests that cover the queue

- `tests/unit/jobs-queue.test.ts`: definitions (cadence default, cron/tz, duplicates, invalid interval, jobId format, JOB_OPTIONS bounds, concurrency validation, TLS/db parsing).
- `tests/unit/jobs-queue-endpoints.test.ts` and `tests/unit/internal-jobs.test.ts`: bearer gating, 204/404/503, no inline delivery.
- `tests/integration/jobs-queue.db.test.ts` (116 lines, real Postgres and Redis): exactly-once delivery with duplicate enqueues and two workers; beat upsert, cadence change and stale removal; delayed retry of a pending SQL row; failure retention and retry; graceful close; stale-claim reclaim; unregistered job rejected.
- `tests/integration/jobs-processes.db.test.ts`: runs `scripts/build-jobs.mjs`, spawns `dist/worker.js` and `dist/beat.js` with a unique `JOBS_QUEUE_PREFIX` and `JOBS_HEALTH_PORT`, and checks `/health` and shutdown.
- `tests/integration/jobs-admin.db.test.ts`: authz for the Jobs page and actions (unauthenticated, other-workspace owners, fresh-MFA super admin, pause/resume with audit).
- `vitest.integration.config.mts` sets `REDIS_URL: ""` in `test.env`; the queue suites `vi.stubEnv("REDIS_URL", TEST_QUEUE_REDIS_URL)`.

### 1.7 Porting BullMQ into an O-based app (concrete deltas)

- **`deliverOutboxBatch`:** O's has signature `(limit = 20)` with no `{ids}` scope. Add W's `scope: { ids?: string[] }` filter (W `lib/outbox.ts:145`). The `OutboxMessage` model and `OutboxStatus` enum are identical in both repos.
- **`recordHeartbeatSuccess`:** W's worker calls `recordHeartbeatSuccess("outbox-scheduler", …)`, which O's `lib/operationalHeartbeat.ts` lacks. O has `recordOutboxSchedulerStarted/Success/Failure` and `OUTBOX_SCHEDULER_HEARTBEAT_KEY = "outbox-scheduler"`. Adapt the call.
- **`describeOperationalError`:** exists in O (`lib/redactSensitiveText.ts`). `validateRuntimeEnvironment` exists in O (`lib/env.ts:90`).
- **Split `runOutboxScheduler()`** (O `lib/outboxWorker.ts`) into registry entries: `membership-sweep`, `payments-reconcile`, `refunds-reconcile`, `report-digest`, `card-exports` (queue `documents`), `outbox-relay` (5s), `operational-retention` (cron). Then delete `docker/ops/scheduler.mjs`, the `scheduler` entrypoint role, `SCHEDULER_MODE`, `SWO_SCHEDULER_TARGET`, and the `scheduler` services in both compose files and in render.yaml. Change `/api/internal/outbox` from "run inline" (O) to "enqueue only" (W) and add `/api/internal/jobs`.
- **`instrumentation.ts`:** replace O's `SCHEDULER_MODE !== "external"` gate with W's dev-only `JOBS_INPROCESS` gate.
- **Globals:** O uses `globalThis.__sweOutboxWorker`, `__sworgReconcileAt`, `__sworgDigestAt` and `__sworgRefundReconcileAt` as in-process throttles. Under beat schedules those throttles become unnecessary; use cron patterns instead.
- **Frontend boundary:** keep `lib/queue/*` `server-only`. The `frontend/` build stubs actions through `frontend/catalog.json`, so a new `app/actions/jobs.ts` must be regenerated into the catalog (`npm run frontend:catalog`).

---

## 2. Differences between W/E and O

### 2.1 Dockerfile

All three are the same shape: `deps → prisma-cli → ops-modules → builder → frontend-builder → frontend → runner`, with `runner` last because Render builds the final stage. The Server Actions key comes from a BuildKit secret or a build-arg fallback.

| | W / E | O |
|---|---|---|
| Extra stage | `migrator` (migration-only target, used by `compose.staging.yml`) | none |
| builder | `RUN npx prisma generate && npm run build:jobs` (W only), `NODE_OPTIONS=--max-old-space-size=4096` | `RUN npx prisma generate` |
| ops-modules | ioredis, @aws-sdk/client-s3, **nodemailer** | ioredis, @aws-sdk/client-s3, **bcryptjs** (for `docker/ops/admin.mjs`) |
| runner copies | `dist/` (W), `scripts/*.mjs`, `docker/vps/` (+node_modules) | `docker/ops/` (+node_modules) only |
| runner apk | `font-dejavu fontconfig openssl` | `font-dejavu openssl` |
| CMD | `["node","server.js"]`; frontend `["node","frontend/server.js"]` | `["--role","backend","node","server.js"]`; frontend `["--role","frontend","node","frontend/server.js"]` |
| Frontend healthcheck | `/brand/icon-192.png` | `/` |
| Env prefix | `SWW_` / `SWE_` (`*_DISABLE_BUILD_CACHE`, `*_FRONTEND_STANDALONE`, `*_NEXT_DIR`) | `SWO_` |

### 2.2 Entrypoint roles (`scripts/docker-entrypoint.sh`)

- **W:** role comes from the command. `migrate` runs `prisma migrate deploy` and exits. `node dist/worker.js`, `node dist/beat.js`, `node docker/vps/*` and `node scripts/*` skip web setup. Anything else is treated as a web server: placeholder rewrite (`spaceworks-workspace-origin.invalid` / `-backend.invalid`), the key check, waiting for `NODE_EXTRA_CA_CERTS` (Caddy local CA), and `MIGRATE_ON_START`. It uses `sed > tmp; cat > file`, which is safe on read-only layers.
- **E:** like W, but `worker` and `beat` are bare words that set `SWE_PROCESS_ROLE` and run `node server.js` on loopback. **This is not BullMQ**: the Next server runs in-process timers in a background role. Do not copy it for this requirement.
- **O:** an explicit `--role` is required (exit 64 without it): `backend|frontend` (web setup), `migrate` (migrate, then `docker/ops/admin.mjs promote-bootstrap` to keep `SUPER_ADMIN_EMAIL` as super admin), `scheduler|ops` (exec as-is). It uses `sed -i`.
- **Recommendation:** keep O's explicit `--role` contract (stricter; tests and docs already assume it) and add roles `worker` → `exec node dist/worker.js` and `beat` → `exec node dist/beat.js` in the same branch as `scheduler|ops`. Keep O's `promote-bootstrap` after migrate. Use W's `sed > tmp` rewrite and its NODE_EXTRA_CA_CERTS wait if you adopt the W split layout with Caddy `local_certs`.

### 2.3 Compose files

**W (and E has the same names and services):**

| File | Purpose |
|---|---|
| `docker-compose.yml` | Dev only: postgres:16 (5440), redis:7 (6395), `silo` + `silo-init` (`pgsty/silo:RELEASE.2026-09-16T00-00-00Z`, 9010/9011, bucket `sww-dev`), mailpit (1025/8025). |
| `compose.production.yml` | VPS stack. Services: `postgres, redis, storage[profile silo], storage-init[silo], migrator, app, frontend[profile split], proxy[profile caddy], worker, beat, ops[profile tools]`. Networks `edge` and `data` (internal). All config is external in `${SWW_CONFIG_DIR}` (`app.env`, `postgres.env`, `storage.env`, `storage-init.env`, `migrator.env`, `frontend.env`, `redis.conf`, `tls/`). Image `${SWW_BACKEND_IMAGE:-sww-backend}:${SWW_VERSION}`, plus an `x-build` anchor with placeholder origins and the `SWW_BUILD_KEY` secret. |
| `compose.external-proxy.yml` | `SWW_CADDY_TLS=proxy`: app on 127.0.0.1:8080, frontend on 8081, `extra_hosts` to host-gateway. |
| `compose.external-storage.yml` | `SWW_STORAGE=external`: `app.depends_on: !override` without storage-init. |
| `compose.internal-tls.yml` | `SWW_CADDY_TLS=internal`: Caddy `local_certs` plus a `caddy-root` exporter so the frontend trusts the local CA. |
| `compose.staging.yml` | Staging stack using the `migrator` target. |
| Layouts (`SWW_LAYOUT`) | `split` (frontend and backend containers, two hostnames, `docker/vps/Caddyfile.split`), `single`, `netlify`. |

Silo service in W: `storage` running `server /data --certs-dir /server-tls --console-address :9001`, healthcheck `curl --cacert /tls/ca.crt https://storage:9000/minio/health/live`. `storage-init` runs `docker/vps/init-storage.sh` with `storage-policy.json`.

Caddy in W: `caddy:2-alpine`, ports 80/443/443-udp, `./docker/vps/${SWW_CADDYFILE:-Caddyfile}`, env `PUBLIC_HOST`, `SITE_HOST` and `SWW_CADDY_OPTIONS`, and a network alias of `${PUBLIC_HOST}` so the frontend reaches the API by its HTTPS name.

**O:**

| File | Purpose |
|---|---|
| `docker-compose.yml` | Dev only: postgres (5432, user `sworg`) and redis (6379). **No Silo and no mailpit in dev.** |
| `docker-compose.prod.yml` | "Bundled" topology. Services: `db, redis, minio (Silo image, ${SILO_IMAGE_TAG}), createbuckets, migrate, backend, scheduler, caddy, backup, backup-storage, ops[tools]`. All env is inline in an `x-app-env` anchor interpolated from the install's `./.env`, with `?` guards. Image `${SWO_BACKEND_IMAGE:-ghcr.io/spaceworks-labs/spaceworks-organization-backend}:${SWO_IMAGE_TAG:-latest}`. Separate owner and app DB roles (`sworg` / `sworg_app`). Built-in scheduled `backup` (postgres image) and `backup-storage` (silo image) services. **No frontend service and no worker/beat.** |
| `docker-compose.cloud.yml` | "Cloud" topology: `migrate`, `backend` (127.0.0.1:8080), `scheduler`, `ops`, with managed PG, Redis and S3. Env from `/etc/spaceworks-organization/cloud.env`. |
| `docker/compose.tls.yml` | Caddy Let's Encrypt (443 tcp/udp, `TLS_EMAIL`). |
| `docker/compose.proxy.yml` | Existing reverse proxy: disables caddy, backend on 127.0.0.1:8080. |
| `docker/compose.external-storage.yml` | Disables minio, createbuckets and backup-storage via `profiles: [storage-disabled]`. |
| `docker/compose.build.yml` | Build-from-source overlay (`SWO_COMPOSE_BUILD_LAYER=1`, `SWO_BUILD_KEY`). |
| Wrapper | `scripts/spaceworks-compose.sh bundled\|cloud …` picks the overlays from `.env` (`SWO_LAYER=none\|tls\|proxy`, `SWO_STORAGE=external`), pins `SWO_IMAGE_TAG` from `.spaceworks-version`, forbids `-f`/`-p`/`--env-file` overrides, project `sworg` / `sworg-cloud`. |

O's Caddy (`deploy/Caddyfile`) is a single `{$SITE_ADDRESS}` site that **returns 404 on `/api/internal/*`** and proxies to `backend:3000`. W's Caddyfile has no such block. Keep O's block whichever base you use.

O's "Website" setup question: `1` = on this server (monolith), `2` = Netlify. The published `spaceworks-organization-frontend` image is only documented for running yourself (`docs/DEPLOYMENT_NETLIFY.md`), not wired into the VPS compose.

### 2.4 install.sh (curl one-liner and menu)

| | W (E identical except branding and no GitHub token) | O |
|---|---|---|
| One-liner | `curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Workspace/main/install.sh \| bash` | `…/SpaceWorks-Organization/main/install.sh \| bash` |
| Flags | `--release TAG`, `--ref REF` (build from source), `--repo O/N`, `--dir`, `--update`, `--help`; env `SWW_GITHUB_TOKEN` for private repos | `--repo`, `--help` (env `SWO_DIR`, `SWO_REPOSITORY`) |
| Hosts | Linux only (x86_64/arm64), root or sudo | Linux, macOS and Windows Git Bash/WSL (Docker Desktop); installs Docker/Compose per distro family, with a checksum-verified Compose plugin fallback |
| Layout | `/opt/spaceworks-workspace/releases/<sha>` + `current` symlink + `install.conf`; secrets in `/etc/spaceworks-workspace` (`SWW_CONFIG_DIR`) | Flat copy in `/opt/spaceworks-organization`, `.env` and `tls/` inside it, `.spaceworks-version` marker |
| Release tag regex | `^v\d+\.\d+\.\d+-[a-z0-9-]+\.\d+\.[0-9a-f]{12}$`; checks the tag points at its own commit | `^\d+\.\d+\.\d+-main\.\d+\.[0-9a-f]{12}$` |
| Hands off to | `scripts/setup-vps.sh` / `scripts/update-vps.sh` (staged in a root-only temp dir) | `setup.sh` (sources `scripts/setup-questions.sh`, `setup-question-input.sh`, `setup-write-environment.sh`, `setup-first-run.sh`) / `scripts/update.sh` |
| **Menu** (installed) | 1 Update · 2 Back up now · 3 Status/health · 4 Backup settings (schedule, age encryption, off-site S3) · 5 Change settings (hostnames, SMTP, bucket) · 6 Server security (ufw/firewalld, unattended upgrades, fail2ban) · 7 Auto-deploy runner (install/remove) · 8 Recover super-admin · 9 Support bundle · 10 Uninstall · 0 Cancel. Plus resume/start-over for an unfinished install. | 1 Update · 2 Back up now · 3 Roll back to previous release · 4 Cancel · 5 Install/re-register the Actions runner |
| Host bundle | none (each release is a full staged tree) | `scripts/install-host-bundle.sh`: copies only the runtime bundle into the install, keeping replaced files for rollback |

### 2.5 scripts/

| Concern | W (`scripts/`, `docker/vps/`) | O (`scripts/`, `deploy/`, `docker/ops/`) |
|---|---|---|
| Setup | `setup-vps.sh` (397), `vps-lib.sh` (447, shared prompts), `install-docker.sh`, `docker/vps/setup.mjs` (generates secrets, TLS CA and certs, `redis.conf`, env files) | `setup.sh`, `setup.ps1`, `setup-questions.sh`, `setup-question-input.sh`, `setup-write-environment.sh`, `setup-first-run.sh`, `deploy/certificates.sh` (CA, `--renew`) |
| Update | `update-vps.sh` (backup, pull or build, migrate, health, roll back on failure), `vps-deploy.sh` (unattended, for the runner) | `update.sh` (175), `update-lock.sh` (flock or PID lock), `update-rollback.sh`, `install-host-bundle.sh` |
| Compose wrapper | `vps-compose.sh` (32) | `spaceworks-compose.sh` (77), `spaceworks-repository.sh` (reads named `.env` values, never sources them) |
| Backup | `vps-backup.sh` (into `$SWW_CONFIG_DIR/backups/<UTC>/`, `--no-objects`), `vps-backup-settings.sh` (systemd `sww-backup.timer`, age, off-site S3), `db-backup.mjs`/`db-backup-lib.mjs` (cloud) | `backup.sh` (on demand) + `deploy/backup.sh` (in-stack `backup`/`backup-storage` schedule services) |
| Restore | `vps-restore.sh`, `db-restore.mjs` | `restore.sh` (`--with-storage`, takes a fresh backup first) |
| Admin | `vps-recover.sh` → `docker/vps/recover-super-admin.mjs` (removes MFA, signs out everywhere, prints a 1-hour reset link) | `admin.sh` → `docker/ops/admin.mjs` (`create`, `set-password`, `reset-mfa`, `revoke`, `list`, `promote-bootstrap`); super-admin passwords are set only on the server |
| Status/checks | `vps-status.sh`, `docker/vps/check.mjs` (DB TLS, schema, Redis TLS/auth, bucket, worker/beat health, split gateway), `check-production-env.mjs`, `verify-production-schema.mjs`, `check-deployment.mjs` | `docker/ops/check.mjs` (`run --rm ops`) |
| Smoke | `test-vps-install.sh` (CI two-image install), `docker/vps/smoke.mjs`, `test-split-hosting.mjs` | `compose-smoke.sh` (full bundled stack, backup and restore, teardown), `verify-release-images.sh`, `test-split-hosting.mjs` |
| Hardening/other | `vps-harden.sh`, `vps-renew-certs.sh` (`sww-certificates.timer`), `vps-reconfigure.sh`, `vps-support.sh`, `vps-uninstall.sh` | — |
| Runner | `install-runner.sh` (label `spaceworks-workspace-prod`, `/usr/local/sbin/sww-deploy`), `runner-release.py` | `install-runner.sh` (label `spaceworks-organization-prod`), `runner-release.py` |
| GHCR retention | `ghcr-retention.mjs` | `ghcr-retention.py` |
| Jobs | `build-jobs.mjs`, `queue/*.ts`, `scheduler.mjs` | `docker/ops/scheduler.mjs` |

### 2.6 render.yaml

- **W:** web `spaceworks-workspace` (plan `0.5c-512mb`, region singapore, `dockerCommand: node server.js`, `preDeployCommand: docker-entrypoint.sh migrate`, `/api/health`), worker `spaceworks-workspace-worker` and worker `spaceworks-workspace-beat`. The workers pull env through `fromService` per key. The header comment says free web plans cannot run workers and points to the cron fallback.
- **O:** `envVarGroups: sworg-prod` (including `SCHEDULER_MODE=external`), web `sworg-backend` (starter, `MIGRATE_ON_START=1`), worker `sworg-scheduler` (`dockerCommand: --role scheduler node docker/ops/scheduler.mjs`, `SWO_SCHEDULER_TARGET`). The header explains why Render Key Value is not used: it is plain `redis://`, and production requires `rediss://`.
- **E:** a single free web service with `MIGRATE_ON_START`.
- **Recommendation:** O's env-group style with W's three services: web plus `worker` (`--role worker node dist/worker.js`) plus `beat` (`--role beat node dist/beat.js`), and `preDeployCommand` or `MIGRATE_ON_START=1`. Redis must be external TLS (Upstash etc.) with noeviction.

### 2.7 The `frontend/` workspace (the split frontend image)

It is the same in all three. `frontend/` is an npm workspace (`"workspaces": ["frontend"]`; W also has `packages/cli`) containing only `package.json` (next/react), `next.config.ts` (extends root config; `output: "standalone"` when `SWO_FRONTEND_STANDALONE=1`), `proxy.ts` (edge-safe; forwards Server Action POSTs to `BACKEND_ORIGIN` with `FRONTEND_GATEWAY_SECRET`), `api-route.ts` (catch-all `/api/*` → `proxyBackendApi`), `instrumentation.ts`, `catalog.json` (generated list of views and actions), `netlify.toml` and `tsconfig.json`. W also has `storage.ts`, `contracts.d.ts`, `model-types*`, `pages.json` and `pure-exports.json`.

`scripts/prepare-frontend.mjs` copies `app/` (minus `app/api`), `components/`, `lib/` and `public/` into `frontend/`, and stubs every view and action from the catalog into RPC calls (`lib/frontend/{client,codec,peer,httpProxy,…}.ts`). `scripts/check-frontend-build.mjs` verifies that no DB, Redis or mail client leaked in.

The backend runs `DEPLOYMENT_MODE=backend` and requires a 64-hex `FRONTEND_GATEWAY_SECRET`. The result is the **frontend GHCR image** (`frontend` Dockerfile target) and the Netlify build. Commands: `npm run frontend:catalog`, `frontend:prepare`, `build:frontend`, `typecheck:frontend`, `test:e2e:split`.

### 2.8 .github/workflows

| Repo | File | What it does |
|---|---|---|
| W | `quality.yml` "Quality gate" | On PR and push to main/dev: scripts-and-manifests (shellcheck, `deployment:check`, helm lint/template `charts/spaceworks-workspace`), calls `ci.yml`, and the "Two-image installer smoke" (`scripts/test-vps-install.sh`). |
| W | `ci.yml` (workflow_call) | quality (lint, types, unit, build); integration (postgres:16 and redis:7 services, starts Silo and creates `sww-docsfiles`, `db:test:prepare`, `test:integration`, with `TEST_QUEUE_REDIS_URL`); audit (advisory); hosting matrix `split\|vps` (`test:e2e:split` / `test:e2e:vps`). |
| W | `release.yml` "Release" | On `workflow_run` of Quality gate on main, or dispatch: prepare (version `<VERSION>-<label>.<run>.<sha12>`; a GitHub Release only for the first main build of a VERSION, or a dispatch; other branches publish pre-releases), build (native amd64 and arm64 runners, backend and frontend by digest), publish (multi-arch tags), github-release, cli-package (GH Packages and npm), deploy (self-hosted `spaceworks-workspace-prod`, `vars.SWW_DEPLOY=='true'`, `sudo -n /usr/local/sbin/sww-deploy v$VERSION`), retention. |
| O | `tests.yml` "Tests" | On PR to dev/main, workflow_call or dispatch: docs-drift (CLAUDE.md must equal AGENTS.md), quality (lint, typecheck, unit, build), database (postgres and redis services; integration then e2e with seeded demo data), shell (shellcheck and `docker compose config` for every layer), images (build the frontend image; build the backend image and run `compose-smoke.sh`). |
| O | `release.yml` "Continuous Release" | On push to **main and dev**: `tests` (reusable) → prepare (`<VERSION>-<channel>.<run>.<sha12>`) → build → publish → github-release (main) → promote-latest (main only and still the branch head: tags `latest`, `main`, series `0.7`; marks release latest; prunes superseded versions; verifies pullability) → deploy (self-hosted `spaceworks-organization-prod`). Dev publishes images tagged `dev`, with no release and no deploy. |
| O | `security-audit.yml` | npm audit on PR and dispatch. |
| E | `ci.yml`, `quality.yml`, `release.yml` | W-style (quality also runs payment browser flows against a fake provider and a standalone-container smoke). |
| E | `yuyu-upstream.yml` | E-specific scheduled upstream check. Do not copy. |

Note: pushing changes under `.github/workflows/` needs the `workflow` gh scope, which the local gh auth lacks (`gh auth refresh -s workflow`).

### 2.9 Release process

- `VERSION` (plain `x.y.z`) + `CHANGELOG.md` + `package.json` version (and `frontend/package.json` version in O).
- **W changelog** is Keep-a-Changelog style (`## [Unreleased]`, `## [0.6.6] - 2026-10-23`). **O changelog** uses `## 0.7.0 (2026-10-21)` with a one-line pitch and bold bullets; releases are titled `Space Works Organization <version>`.
- GHCR images:
  - `ghcr.io/<owner-lowercase>/spaceworks-workspace-backend` and `-frontend`
  - `ghcr.io/<owner>/spaceworks-organization-backend` and `-frontend`
  - `ghcr.io/<owner>/spaceworks-events-backend` and `-frontend`
- Tags are immutable `x.y.z-main.<run>.<sha12>`. O adds rolling tags `latest`, `main`, `<series>` and `dev`.

### 2.10 docs/

- **W:** API, APP_REVIEWS, ARCHITECTURE, CONFIGURATION, CONTAINER_IMAGES, DEPLOYMENT_{AWS,CLOUD,DOCKER,KUBERNETES,SPLIT,STAGING,VPS}, DESIGN, DEVELOPMENT, INTEGRATIONS, MCP, MONITORING, PRODUCTION_RELEASE, README, ROADMAP-BUILD, SOCIAL, design-audit, production-operations, `areas/`, `readme/`.
- **O:** ARCHITECTURE, CONFIGURATION, DEPLOYMENT_{CLOUD,NETLIFY,VPS}, DESIGN, GST, NOTIFICATIONS, PAYMENTS, REPORTS, SECURITY, `plans/`, `readme/`.
- **E:** API, ARCHITECTURE, AUTH_REVIEW, CONFIGURATION, CONTAINER_IMAGES, DEPLOYMENT_{CLOUD,DOCKER,SPLIT,STAGING,VPS}, DESIGN, DEVELOPMENT, FEATURES, FUTURE_PHASES, PAYMENTS, PERMISSIONS, PRODUCTION_READINESS_AUDIT, PRODUCTION_RELEASE, README, ROUTES, SECURITY, TESTING, `manual/`, `plans/`, `readme/`, Yuyu-User-Manual.pdf.
- **W extras not elsewhere:** `charts/spaceworks-workspace` (Helm), `.do/app.yaml` (DigitalOcean), `deploy/cloudflare-cron`, `packages/cli`, `local.sh`.

---

## 3. Recommendation per concern

| Concern | Base | Why / what to change |
|---|---|---|
| App code, auth, tenancy, payments, outbox model | **O** | As planned. |
| Queue (`lib/queue/*`, `lib/scheduled/index.ts`, `scripts/queue/*`, `scripts/build-jobs.mjs`, `/api/internal/{jobs,outbox}`, admin Jobs page and action, the 6 queue tests) | **W** | Port per section 1.7. Start the registry with only O's existing jobs; drop W's ~30 area modules. Reduce `QUEUE_NAMES` to what you use (likely `outbox`, `scheduled`, `documents`). Drop the `secrets-rotation` and `google-meet` kinds. |
| Dockerfile | **O** + W's `build:jobs` line and `COPY dist` | Keep O's `--role` CMDs and ops-modules (bcryptjs for admin.mjs). |
| Entrypoint | **O** + `worker` and `beat` roles | See 2.2. |
| VPS compose | **O `docker-compose.prod.yml`** + W's `worker` and `beat` services (healthcheck on 3460, `stop_grace_period: 10m`, networks `[edge, data]`) replacing `scheduler`. Add W's `frontend` service only if you want an on-VPS split layout (it needs W's `Caddyfile.split` and the internal-TLS overlay); otherwise keep O's Netlify-or-monolith choice and still publish the frontend image. | O's stack is simpler (one `.env`, built-in backup services, owner and app DB roles, Caddy `/api/internal` 404). |
| Silo | Either; they are equivalent | Same image `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`, TLS certs dir, console :9001, policy-limited app identity. O names the service `minio`/`createbuckets` with a `SILO_IMAGE_TAG` override; W uses `storage`/`storage-init`. If you start from O, consider renaming the service to `silo` for clarity (update `S3_ENDPOINT` default `https://minio:9000`, `deploy/certificates.sh` SANs, `createbuckets.sh`, `backup.sh`, the `tls/minio` dir, and compose-smoke). Add W's dev `silo` + `silo-init` + mailpit to O's dev `docker-compose.yml`. |
| Caddy | **O** `deploy/Caddyfile` + overlays | Keeps `/api/internal/*` → 404. |
| install.sh + menu | **O** structure, extending the menu with W items | O's handles macOS and Windows hosts, the host bundle and rollback. W's menu is richer (status, backup settings, reconfigure, hardening, recover, support, uninstall). Port the W items you need as scripts. At minimum add "Check status" (`spaceworks-compose.sh bundled run --rm ops`) and "Recover super-admin" (`admin.sh reset-mfa`). Keep O's release regex `-main.`. |
| scripts/ update, backup, restore, admin, smoke | **O** | `update.sh` + `update-lock.sh` + `update-rollback.sh`, `backup.sh`/`restore.sh`/`deploy/backup.sh`, `admin.sh` + `docker/ops/admin.mjs`, `compose-smoke.sh`. Extend `compose-smoke.sh` and `docker/ops/check.mjs` to probe `worker:3460/health` and `beat:3460/health` (W `docker/vps/check.mjs:57`). |
| render.yaml | **O** env group + W's worker/beat services | See 2.6. |
| cloud compose | **O** `docker-compose.cloud.yml` | Swap `scheduler` for `worker` and `beat`. |
| frontend/ | **O** (identical in all three) | Regenerate the catalog after adding actions. |
| Workflows | **O** `tests.yml` + `release.yml` + `security-audit.yml` | Add `TEST_QUEUE_REDIS_URL: redis://127.0.0.1:6379/0` to the database job. Add a `build:jobs` check to quality, or rely on `jobs-processes.db.test.ts`. |
| Release / VERSION / CHANGELOG | **O** | Reset `VERSION` to `0.1.0`. |

### 3.1 Strings to rename (O → Bookings)

Suggested target: `spaceworks-bookings`, prefix `SWB_`, short name `swbook` (avoid `swb` if it collides with anything else of yours).

- **Product/display:** `Space Works Organization` (around 92 hits, including the MFA issuer `ISSUER` in `lib/mfa.ts`, email branding, README, installer messages), `Space Works installer`, `SpaceWorks-Organization`, `SpaceWorks-Labs/SpaceWorks-Organization` (install.sh one-liner, default repo, docs).
- **Package/images:**
  - `spaceworks-organization` (package.json name), `spaceworks-organization-frontend` (frontend/package.json)
  - `ghcr.io/spaceworks-labs/spaceworks-organization-backend` / `-frontend` (compose defaults, `scripts/spaceworks-repository.sh:27`, `verify-release-images.sh`, release.yml)
- **Placeholders:** `spaceworks-organization-origin.invalid` and `spaceworks-organization-backend.invalid` (Dockerfile build args, entrypoint, `docker/compose.build.yml`, release.yml).
- **Paths:**
  - `/opt/spaceworks-organization` (`SWO_DIR` default)
  - `/etc/spaceworks-organization` (cloud.env, spaceworks-compose.sh, docs)
  - `.spaceworks-version`, `.spaceworks-answers`, `.sworg-stage.*`
- **Env prefix `SWO_`:**
  - Repo and install: `SWO_REPOSITORY`, `SWO_DIR`, `SWO_STATIC_ENV_FILE`, `SWO_INSTALL_REPOSITORY_PINNED`
  - Images and build: `SWO_IMAGE_TAG`, `SWO_BACKEND_IMAGE`, `SWO_FRONTEND_IMAGE`, `SWO_BUILD_KEY`, `SWO_COMPOSE_BUILD_LAYER`, `SWO_DISABLE_BUILD_CACHE`, `SWO_FRONTEND_STANDALONE`, `SWO_NEXT_DIR`
  - Compose: `SWO_COMPOSE_PROJECT`, `SWO_LAYER`, `SWO_STORAGE`, `SWO_TLS_DIR`, `SWO_BACKUP_DIR`, `SWO_TOPOLOGY`, `SWO_ADMIN_TOPOLOGY`
  - Update and runner: `SWO_UPDATE_INSTALL_DIR`, `SWO_UPDATE_STAGE_DIR`, `SWO_UPDATE_STAGED`, `SWO_ROLLBACK`, `SWO_RUNNER_DIR`, `SWO_DEPLOY` (repo variable for auto-deploy)
  - Other: `SWO_SMOKE_PORT`, `SWO_SCHEDULER_TARGET` (delete with the scheduler)
- **DB/compose names:**
  - DB user, DB name and roles: `sworg`, `sworg_app`, `sworg_dev`, `sworg_test`, `sworg_e2e`
  - Volume and projects: `sworg_pgdata`, project names `sworg` / `sworg-cloud`
  - Bucket and identity: S3 app identity `sworg-app`, bucket default `spaceworks-organization`
  - Render: env group `sworg-prod`, services `sworg-backend` / `sworg-scheduler`
  - Misc: `sworg-smoke`, `sworg-root`, `sworg-curl-installer` (User-Agent), `sworg-self-host-updater`, `swo_split`, `swo_split_test`
- **Runner:** labels `spaceworks-organization-prod`, `spaceworks-organization-prod-deploy`, `spaceworks-organization-runner`.
- **Cookies/keys:**
  - Cookies: `swo.session-token.v1` (`lib/auth.ts` `sessionCookieName`), `swo.device` (`lib/loginSecurity.ts`), `swo.theme`
  - Browser storage and events: `swo:theme-change`, `swo.card-seen.*`, `swo.cardRenderSlot`, `swo.cardExportRun`
  - Redis keys: `swo:loginfail:`, `swo:ipblock:`, `swo:ipblocked-before:` (lib/ipBlock.ts)
  - Globals: `__sweOutboxWorker`, `__sweApiMonitor`, `__sworg*At`
- **From W when porting the queue:** `sww:jobs` (prefix default in `client.ts` and `worker.ts`), `sww:jobs:heartbeat:` (`runtime.ts`), `Symbol.for("sww.queues")`, `sww:ratelimit:` (if you take W's rate limit), `SWW_*` in any copied compose or script, and `sww-backend`/`sww-frontend` local image names.

### 3.2 App-specific coupling to strip or replace

- **O's `runOutboxScheduler` jobs:** membership sweep, payments and refunds reconcile, monthly digests, card exports.
- **Env:** `PAYMENT_SECRETS_KEY` (keep, since Bookings has payments), `PWNED_PASSWORDS_CHECK`, `OUTBOX_RETENTION_DAYS`.
- **`lib/outboxKinds.ts`** handlers: membership, cards, GST, erasure, chat, report digest.
- **Seeds:** `seed-demo.mjs` / `seed-reports.mjs` (membership data).
- **Design:** `sync-design.mjs` / `sync-patch.mjs` (design-kit vendoring; keep if Bookings uses the Space Works design kit).
- **Docs:** GST, REPORTS, `docs/plans/2026-10-19-membership-rebuild.md`.
- **W-only:** Helm chart, DO, Cloudflare cron, `packages/cli`, `ANTHROPIC_API_KEY`.

---

## 4. O's auth stack (keep or drop)

| File | What it does | Keep? |
|---|---|---|
| `lib/auth.ts` (234) | NextAuth v5 (`next-auth` 5.0.0-beta.32, `@auth/prisma-adapter` 2.11.3). JWT sessions, versioned cookie `swo.session-token.v1` (port-suffixed in dev), `trustHost`, redacted logger, `pages.signIn=/login`. **Providers:** Google, GitHub and Apple (enabled from instance settings or env via `getOAuthSettings()`, `allowDangerousEmailAccountLinking`, guarded by a verified email) plus **Credentials** (email, password, `totp`, `emailCode`). The authorize flow: IP block check, auth rate limit, bcrypt with a constant-time dummy hash, verified email required, then either TOTP or a recovery code (when MFA is on) or an emailed login code (new device, no MFA, not verified in the last hour); then remember the device. Typed errors: `mfa_required`, `email_verification_required`, `email_code_required`, `address_blocked`. Callbacks: `signIn` (provider-verified email, super admins refused via OAuth, registration policy), `jwt` (`sessionVersion` revocation, `authenticatedAt`), `session`. **No magic-link / Email provider.** | Keep |
| `lib/authAdapter.ts` (26) | PrismaAdapter wrapper: lowercases `getUserByEmail`, refuses linking to an unverified password account, and `linkAccount` drops OAuth tokens. | Keep |
| `lib/mfa.ts` (97) | TOTP (`otpauth` 9.5.2). AES-GCM encrypted seed (`MFA_ENCRYPTION_KEY`, 32-byte base64), `createMfaEnrollment`, `verifyMfaCode`, `generateRecoveryCodes` / `hashRecoveryCode` / `consumeRecoveryCode` (atomic array removal in SQL), `consumeMfaCode` (replay protection via a `VerificationToken` row `identifier:"mfa-replay"`). Issuer string `"Space Works Organization"`. | Keep; rename issuer |
| `lib/loginSecurity.ts` (82) | Known-device cookie `swo.device` (400 days, hashed `KnownDevice` rows, keeps 20); a 6-digit emailed login code (10 min TTL, resend after 60s, stored as `VerificationToken` `login-code:<userId>`); new-device alert via outbox. | Keep |
| `lib/ipBlock.ts` (113) | Redis (memory in dev): 20 failed sign-ins in 15 min blocks the IP for 1 hour; a repeat within 7 days blocks for 24 hours. Applies only to sign-in, sign-up and reset. `listBlockedIps`/`unblockIp` for super admins (`app/actions/ip-blocks.ts`, `app/super-admin/security`). | Keep |
| `lib/permissions.ts` (140) | `requireAuth`, `requireSuperAdmin` (`User.isSuperAdmin` and verified email, otherwise `notFound`), `requireOrgTeam/Role/Membership/Capability/DashboardAccess`, `orgActionAccess`, `hasAuthenticator`. **Staff (any TeamMember) must have TOTP** (redirect to `STAFF_AUTHENTICATOR_SETUP`); members and super admins need not. | Keep; adapt org to tenant naming |
| `lib/permissionRoles.ts` (87) | `TeamRole` enum `OWNER, ADMIN, TREASURER, VIEWER`; `CAPABILITIES` map (org.*, team.manage, plans.manage, members.*, cards.manage, payments.*, reports.*, audit.view, erasure.decide); `SUSPENDED_CAPABILITIES`; `organisationAllows(status)`; `hasRoleAtLeast`, `canManageTeamMember`. `TeamMember` has `role`, optional `unitId` scope and `reportDigest`. | Keep the mechanism; rewrite the capability list for bookings |
| `lib/reauth.ts` (17) | `hasRecentAuthentication()` from the JWT `authenticatedAt`, for sensitive changes. | Keep |
| `lib/emailVerification.ts` (57) + `lib/email/emailVerification.ts` | Issue and verify email tokens via the outbox. | Keep |
| `lib/breachedPassword.ts` (36) | HIBP k-anonymity check with padding (`PWNED_PASSWORDS_CHECK=0` disables it). | Keep |
| `lib/passwordPolicy.ts` (7) | Length rules. | Keep |
| `lib/oauthProviders.ts` (104) | Instance-settings-first provider config, Apple client-secret JWT minting, `providerVerifiedEmail`. Managed in `app/actions/sign-in-providers.ts` and `app/super-admin/auth`. | Keep, or drop Apple |
| `lib/rateLimit.ts` (192), `lib/actionRateLimit.ts` | Redis or memory buckets (including `auth` and `passwordReset`), `getClientIpFromHeaders`, `getRedisClient`. | Keep |
| `lib/accountSecurity.ts` (40) | Labels for the account Security page. | Keep |
| `lib/authRedirect.ts`, `lib/bearerSecret.ts`, `lib/pageSecurity.ts`, `proxy.ts` | Safe redirects, constant-time bearer compare, CSP/security headers, edge rate limiting and the frontend-peer gateway. | Keep |
| `lib/inviteAcceptance.ts` | Single-use, email-bound team invites. | Keep and adapt |
| Super admin | `User.isSuperAdmin`; bootstrapped from `SUPER_ADMIN_EMAIL` by `docker/ops/admin.mjs promote-bootstrap` (run after every migrate); passwords set only via `scripts/admin.sh`; OAuth refused for super admins. | Keep |
| Actions and pages | `app/actions/{auth,security,password-reset,account,ip-blocks,sign-in-providers,invite-acceptance}.ts`; `app/(auth)/{login,reset-password,verify-email}`; `app/account/security`; `app/super-admin/{security,auth,users,…}`; `app/api/auth/[...nextauth]`. | Keep |
| Prisma | `User` (`passwordHash`, `sessionVersion`, `mfaSecretEncrypted`, `mfaEnabledAt`, `recoveryCodeHashes[]`, `isSuperAdmin`), `Account`, `Session`, `VerificationToken` (also used for MFA replay and login codes), `KnownDevice`, `TeamMember`, `TeamInvite`, `AuditEvent`, `InstanceSetting`. | Keep |
| Tests | Unit: `auth-*`, `mfa`, `login-protections`, `security-actions`, `oauth-providers`, `super-admin-*`, `password-reset`, `email-verification`. Integration: `auth-hardening`, `login-security`, `mfa-recovery`. | Keep |

---

## 5. O's test organisation

- **Unit** (`vitest.config.mts`): `tests/unit/**/*.test.ts` (80 files), node environment, aliases `@` → root and `server-only` → `tests/helpers/server-only.ts`, hermetic env `NEXT_PUBLIC_BASE_URL=http://localhost:3000` and `PWNED_PASSWORDS_CHECK=0`. Run with `npm test` / `npm run test:unit`.
- **Coverage** (`vitest.coverage.config.mts`): unit only, v8, include `lib/**/*.ts` and `app/actions/**/*.ts`, ratchet thresholds statements 10 / branches 6 / functions 12 / lines 10. Run with `npm run test:coverage`.
- **Integration** (`vitest.integration.config.mts`): `tests/integration/**/*.test.ts` (19 files, named `*.db.test.ts`, plus a `payments-helpers.ts` helper). It **throws unless `TEST_DATABASE_URL` is set**, then forces `DATABASE_URL = DIRECT_URL = TEST_DATABASE_URL`. `fileParallelism:false`, sequential, 20s timeout.
  - **Getting a DB:** you migrate the disposable DB yourself (`DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy`; CI does exactly this). Tests create fixtures with random suffixes (`auth-${suffix}@example.test`) and do not truncate.
  - W adds `scripts/prepare-test-db.mjs` (`npm run db:test:prepare`) and reads `TEST_DATABASE_URL` from `.env`; worth porting.
  - For BullMQ, add W's `TEST_QUEUE_REDIS_URL` convention and keep `REDIS_URL: ""` in the integration config's `test.env`.
- **E2E** (`playwright.config.ts`): `tests/e2e/{public.spec.ts, signed-in.spec.ts, totp.ts}`, chromium only, not fully parallel, CI retries 2 with a 120s timeout. The `webServer` is `npm run dev`, or with `PLAYWRIGHT_PRODUCTION_SERVER=1` `node .next/standalone/server.js` (`npm run test:e2e:production`); it waits on `/api/health`, port `PLAYWRIGHT_PORT` (3000), on 127.0.0.1. Signed-in specs skip unless `DEMO_PASSWORD` and `DEMO_MFA_SECRET` are set; `totp.ts` hands out unused TOTP steps to beat replay protection. In CI the e2e DB is `sworg_e2e`, created via psql, migrated, then `db:seed-demo` and `db:seed-reports`.
  - Separate hosting smokes: `test:e2e:split` / `test:e2e:vps` (`scripts/test-split-hosting.mjs`) and `scripts/compose-smoke.sh` (in the `images` CI job).
- **File-length test** (`tests/unit/file-length.test.ts`):
  - Rule: owner rule `LIMIT = 300` lines.
  - Scope: walks `app, components, lib, scripts, tests, frontend, prisma` for `.ts, .tsx, .mjs, .js, .css, .sh`.
  - Skips: `lib/frontend/registry.ts`, `app/styles/tokens.css`, the generated `frontend/{app,components,lib,public,.next}` and `node_modules`.
  - Root files (`install.sh` at 419 lines, `setup.sh`) are outside the scanned dirs, which is why install.sh may exceed the limit; its header says so.
  - Impact of the port: W's `lib/scheduled/index.ts` (86) and the queue files are all under 300. Keep the registry small.
- **CI:** `tests.yml` docs-drift requires `CLAUDE.md` to be identical to `AGENTS.md`. Keep both in sync in the new repo, or drop that job.
