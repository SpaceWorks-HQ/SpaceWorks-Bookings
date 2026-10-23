# CLAUDE.md

Guidance for Claude Code (and other agents, via `AGENTS.md`) in this repository. `AGENTS.md` must stay
byte-identical to this file (CI checks it).

## Project

**Space Works Bookings** is a self-hostable (AGPL-3.0-or-later), multi-tenant platform for booking a makerspace's
**spaces**: rooms, studios, desks and halls (no machine booking). One install runs several **makerspaces**; the
makerspace is the tenant. The platform super admin creates makerspaces, or reviews the ones that apply at `/start`.

- **Words:** makerspace = tenant (`Makerspace`, `makerspaceId`, `/m/[makerspaceSlug]`, `/makerspaces`). Space = a
  bookable thing inside a makerspace (Phase 1). Never call the tenant a "space" in code.
- **Build plan:** `docs/plans/2026-10-23-bookings-build.md`, phase by phase; research notes in `docs/plans/research/`.
  Each phase ends with green gates, a commit and a push to `dev`. Never push or merge to `main`.
- **Phase 0 (done):** the platform forked from the Space Works membership platform (see `NOTICE`), renamed, with
  membership stripped, magic link sign-in, the bookings roles and the BullMQ worker and beat.

## Stack

- **App framework:** Next.js 16 (App Router, React Server Components, Server Actions), React 19, TypeScript
  strict, with `@/*` as the path alias for the repo root.
- **Data:** PostgreSQL 16 through Prisma 6 (`prisma/schema.prisma`). `DATABASE_URL` is the runtime/pooled
  connection; `DIRECT_URL` is for migrations. `scripts/prisma.mjs` defaults it to `DATABASE_URL`.
- **Services:**
  - Redis (ioredis) for rate limits and IP blocks, and BullMQ for background jobs
  - S3-compatible storage (Silo on a VPS, R2 or any S3 in the cloud)
  - Nodemailer with a database outbox
- **Auth:** Auth.js v5 with JWT sessions and Credentials only (password, and the emailed `magic-link`); no SSO and no
  adapter tables.
- **Design:**
  - **Brand:** SpaceWorks-Design is the only source of brand truth (tokens, logos, fonts).
  - **UX:** Space Works UX, from SpaceWorks-Design `docs/ux-spec.md`.
  - **Buttons and controls:** pill-shaped (`--radius-control: 9999px`).
  - **Fonts:** only the free Gilroy weights (Light 300 for text, ExtraBold 800 for headings), plus Unbounded for
    one accent phrase per layout.
  - **Patch (mascot):** `components/brand/Patch.tsx` (idle, sneeze, walk), artwork from SpaceWorks-Design via
    `scripts/sync-patch.mjs`. Never recolour, mirror or resize it past native size, never beside the box logo, never
    on makerspace-branded public pages, and it counts as a layout's one bold moment. Placements and easter eggs are
    in `docs/DESIGN.md`.
- **Frontend split:** pages read data only through `lib/views/*` loaders and mutate through `app/actions/*`; the
  `frontend/` workspace builds a separate image that calls them over RPC. After adding or renaming a view or an
  action, run `npm run frontend:catalog` (regenerates `lib/frontend/registry.ts` and `frontend/catalog.json`).

## Commands

```bash
npm ci                     # install (runs prisma generate)
npm run dev                # dev server on :3000
npm run lint               # ESLint (next core-web-vitals + typescript)
npm run typecheck          # next typegen + tsc --noEmit
npm run test:unit          # Vitest unit tests (tests/unit)
npm run test:integration   # needs TEST_DATABASE_URL (disposable, migrated); queue suites use TEST_QUEUE_REDIS_URL
npm run test:e2e           # Playwright (tests/e2e); signed-in journeys need db:seed-demo, DEMO_PASSWORD, DEMO_MFA_SECRET
npm run build              # production build (standalone output)
npm run build:jobs         # bundle the BullMQ worker and beat into dist/ (esbuild)
npm run worker             # run dist/worker.js (needs REDIS_URL)
npm run beat               # run dist/beat.js (needs REDIS_URL)
npm run build:frontend     # the split frontend workspace
npm run frontend:catalog   # regenerate the frontend view/action catalog
npm run db:migrate         # create/apply a migration in development
npm run db:deploy          # apply migrations
npm run db:seed-demo       # Tinkerspace demo makerspace + owner@demo.test (DEMO_PASSWORD, DEMO_MFA_SECRET, MFA_ENCRYPTION_KEY)
```

Without Redis in development, set `JOBS_INPROCESS=true` and leave `REDIS_URL` unset: `npm run dev` then runs every
registered job once a minute in the web process.

Operations (bash; see `docs/DEPLOYMENT_VPS.md`, `docs/DEPLOYMENT_CLOUD.md`, `docs/CONFIGURATION.md`):

```bash
bash setup.sh [--build]                                  # guided install from a checkout (setup.ps1 on Windows)
scripts/spaceworks-compose.sh bundled up -d              # the only way to run docker-compose.prod.yml
scripts/spaceworks-compose.sh bundled run --rm ops       # operator checks (incl. worker and beat health)
scripts/spaceworks-compose.sh cloud up -d                # docker-compose.cloud.yml with /etc/spaceworks-bookings/cloud.env
bash scripts/update.sh --force [--version V | --rollback]
bash scripts/backup.sh && bash scripts/restore.sh backups/<dump>.sql.gz [--with-storage]
bash scripts/admin.sh create|set-password|reset-mfa|revoke|list --email <address>   # super admins (server only)
SWB_COMPOSE_BUILD_LAYER=1 bash scripts/compose-smoke.sh  # bundled stack end to end (disposable)
```

Run one unit test file:

```bash
npx vitest run tests/unit/health.test.ts
```

## Conventions

- **Tenant isolation is enforced in the application** (there is no RLS):
  - Every tenant row carries `makerspaceId`, with composite FKs to its parent.
  - Every query is scoped through the makerspace resolved for the request.
  - Cross-tenant access returns 404.
- **Roles and capabilities** (`lib/permissionRoles.ts`): `OWNER`, `SPACE_MANAGER`, `BOOKINGS_MANAGER`, `FRONT_DESK`,
  `TREASURER`, `VIEWER`, mapped to capabilities (`makerspace.*`, `team.manage`, `spaces.manage`, `bookings.*`,
  `payments.*`, `refunds.manage`, `members.manage`, `reports.*`, `integrations.manage`, `audit.view`). Gate pages
  with `requireMakerspaceCapability` and actions with `makerspaceActionAccess`; never check role names directly.
  Rank for who manages whom: owner > space manager > bookings manager > treasurer = front desk > viewer; owners
  manage everyone, others only less senior roles. A suspended or archived makerspace keeps only
  `SUSPENDED_CAPABILITIES` (finishing money already received).
- **Money:**
  - Amounts are integer minor units (paise); never add amounts across currencies.
  - Receipt numbers are gapless per makerspace per financial year (April–March, in the makerspace's timezone).
  - Paid rows are never edited or deleted; reverse them with credit notes. Triggers in `0001_init` enforce it.
  - Payments live in `lib/payments/*` (see `docs/PAYMENTS.md` and `docs/GST.md`). Create them with
    `createPayment` (customer, currency, items, optional `bookingId`), settle only through `settlePayment`, refund
    through `createRefund` then `sendRefundToGateway`. `Payment.bookingId` is a placeholder until Phase 2 re-points
    payments at bookings. Gateway secrets need `PAYMENT_SECRETS_KEY`.
- **Accounts and sign-in** (`docs/SECURITY.md`):
  - Password or emailed one-time link (`lib/magicLink.ts`: hashed `VerificationToken` `magic-link:<email>`, 15
    minutes, single use, rate limited, IP-block aware, no account enumeration, still asks for the authenticator).
    No SSO: never add OAuth providers.
  - Super admins sign in with email and password only (never by link), and are created, revoked and given
    passwords only on the server (`docker/ops/admin.mjs` through `scripts/admin.sh`). Never add an in-app or
    emailed way to make a super admin or reset their password; `requireSuperAdmin` checks only `User.isSuperAdmin`.
  - Staff (any `TeamMember`) need an authenticator before the dashboard opens: `requireMakerspaceTeam`,
    `makerspaceActionAccess` and the document routes check `hasAuthenticator`. Customers never need one.
  - New browsers: `lib/loginSecurity.ts` (known-device cookie, emailed code for accounts without an
    authenticator, new-device alert). Failed sign-ins feed `lib/ipBlock.ts`. Every new password passes
    `isBreachedPassword` (`lib/breachedPassword.ts`).
- **Notifications** (`docs/NOTIFICATIONS.md`):
  - Customer emails pass `makerspaceId` to `sendBrandedEmail`, which uses the makerspace's own SMTP
    (`MakerspaceEmailSettings`) or the platform's in its name. Account emails never pass it.
  - Emails go through the SQL outbox (`enqueueOutbox` in the caller's transaction; kinds in `lib/outboxKinds.ts`).
  - Team chat alerts (Slack, Discord, Mattermost, Telegram, WhatsApp) are queued with `queueChatAlerts` in the
    event's transaction (`lib/chat/*`; events in `lib/chat/events.ts` and the CHECK in `0001_init`). Makerspace
    secrets use `encryptMakerspaceSecret`; hosts a makerspace types in must pass `assertPublicHost`.
- **Background jobs** (BullMQ, ported from SpaceWorks-Workspace): periodic work is a `JobDefinition` in
  `lib/scheduled/index.ts` (`{ area, queue?, schedule?: { every } | { pattern, tz }, run(now) }`); beat upserts a
  scheduler `registry-<area>` per entry and the worker runs it. Ad-hoc jobs add a `QueueJob` kind in
  `lib/queue/definitions.ts` and a branch in `lib/queue/worker.ts`, enqueued with a stable `jobId`. Redis carries
  ids only; SQL owns retry timing for the outbox. Queue prefix `swb:jobs` (`JOBS_QUEUE_PREFIX`).
- **Public pages:** `/m/[makerspaceSlug]` is the makerspace's own page (name, logo, description, contact; spaces
  come in Phase 1). User content is rendered as React text, never as HTML strings.
- **Reports:** the pure helpers in `lib/reports/*` (periods, money totals, chart scales, masking, finance and GST
  maths) are unit-tested; report pages arrive in Phase 3.
- **File size:** no source file over 300 lines (owner rule). Split by responsibility; `tests/unit/file-length.test.ts`
  enforces it, skipping generated files. `tests/unit/product-names.test.ts` keeps the old product names out.
- **Operations:**
  - Two images from one `Dockerfile`: `spaceworks-bookings-backend` (`runner`; every backend role through
    `scripts/docker-entrypoint.sh --role backend|migrate|worker|beat|ops`) and `spaceworks-bookings-frontend`
    (`frontend`). Public origins are placeholders replaced at start; never bake an installation's key or origin.
  - The `worker` (`node dist/worker.js`) and `beat` (`node dist/beat.js`) serve `/health` on `JOBS_HEALTH_PORT`
    (3460). `/api/internal/outbox` and `/api/internal/jobs` only enqueue (bearer `CRON_SECRET`), for hosts without
    a worker; Caddy hides them.
  - Every new environment variable goes into `.env.example`, `.env.production.example`, the compose
    `x-app-env` blocks and `docs/CONFIGURATION.md`.
  - Shell scripts are bash or POSIX sh, LF, and pass `shellcheck -S warning -x`. Host files an update must
    replace are listed in `scripts/install-host-bundle.sh`.
- **Copy:** sentence case, en-GB, buttons named after their action, and no "Oops" or exclamation marks on errors.
  User-facing copy says "makerspace" for the tenant and "customer" for whoever books or pays.
- **Line endings:** LF everywhere (see `.gitattributes`). Never commit `.env*` files except the `*.example` ones.
- **Commit trailers:**
  ```
  Co-Authored-By: Shaan-Shoukath <shaanshoukath4522@gmail.com>
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
