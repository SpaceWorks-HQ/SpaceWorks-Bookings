# Handoff: Space Works Bookings

Read this first, then `CLAUDE.md` (same as `AGENTS.md`) and `docs/plans/2026-10-23-bookings-build.md`.
That is the full spec and phase plan; its "v2 amendments" section overrides the earlier sections. Also
read `docs/PAYMENTS.md`, `docs/GST.md`, `docs/plans/ops-notes.md` and the Django survey under
`docs/plans/research/`. Snapshot taken 2026-10-23.

## Where this repo fits

Space Works is a family of self-hosted, open-source (AGPL-3.0-or-later) tools for makerspaces and
communities, published under the [SpaceWorks-HQ](https://github.com/SpaceWorks-HQ) GitHub org.
The original product, [SpaceWorks](https://github.com/SpaceWorks-HQ/SpaceWorks) (Django + React), bundles
inventory, lending, machines, 3D printing, space bookings and payments in one app. On 2026-10-23 three of
those areas were split out into **standalone apps**, each in its own repo:

| Repo | What it is |
| --- | --- |
| [SpaceWorks-Inventory](https://github.com/SpaceWorks-HQ/SpaceWorks-Inventory) | Stock room and lending desk: setup wizard, catalogue, QR, counts, transfers between locations and spaces, free or paid member lending |
| [SpaceWorks-Machines](https://github.com/SpaceWorks-HQ/SpaceWorks-Machines) | Machine types and catalogue, job/service requests (3D printing, laser, CNC…), pricing and payments, consumables, maintenance and usage logs, 3D-printer hardware adapter layer |
| [SpaceWorks-Bookings](https://github.com/SpaceWorks-HQ/SpaceWorks-Bookings) | Space booking (rooms, studios, desks, halls) with every payment and refund scenario |

Sibling apps on the same stack, used as the reference for structure, install and deploy:
[SpaceWorks-Events](https://github.com/SpaceWorks-HQ/SpaceWorks-Events),
[SpaceWorks-Workspace](https://github.com/SpaceWorks-HQ/SpaceWorks-Workspace) and the Space Works membership platform (see `NOTICE`).
Brand and UI rules come only from [SpaceWorks-Design](https://spaceworks-hq.github.io/SpaceWorks-Design/).

## Decisions already made (do not re-open without the owner)

- **Stack:** Next.js 16 + React 19 + TypeScript, PostgreSQL 16 with Prisma, Auth.js, Tailwind 4 + Radix,
  Redis with a BullMQ `worker` and `beat`, S3-compatible private storage (Silo on a VPS), Vitest and
  Playwright. Domain logic is *ported* from the Django SpaceWorks code, not copied.
- **Multi-space:** one install runs several makerspaces; every tenant row and query is scoped to one.
- **Own accounts per app** (email + password, magic link, TOTP MFA). No SSO.
- **Fully standalone:** no runtime dependency on any other Space Works app. Integration happens later
  through each app's REST API (API keys) and signed outbound webhooks.
- **Free and paid everywhere:** every flow works free or paid. Payments use Razorpay, Stripe,
  offline (cash/bank/UPI recorded by staff) or pay later (shown as *payment pending*), with refunds.
- **Nothing hardcoded:** the Space manager has makerspace-wide settings; the domain manager
  (Inventory / Machine / Bookings manager) has their own settings area; both are RBAC-gated and every
  settings change is audited.
- **Ship requirements:** a README with real Playwright screenshots (light and dark) under
  `docs/screenshots/`, a one-line VPS install (`curl -fsSL …/main/install.sh | bash`) and one-click
  cloud hosting (`render.yaml` + Deploy to Render button).

## How work is done here

- `dev` is the integration branch; `main` is production and only **Shaan-Shoukath** merges into it
  (branch protection + `.github/CODEOWNERS`). Branch from `dev`, open PRs into `dev`.
- Work in phases; each phase ends with lint, typecheck and tests green, a commit and a push to `dev`.
- `CLAUDE.md` and `AGENTS.md` are byte-identical; edit one, copy it over the other.
- The original build was done by Claude Code sessions (no Codex). Any coding agent can continue from
  this file plus `CLAUDE.md`.

## Bookings-specific decisions

- Words: **makerspace** is the tenant. A **space** is a bookable room, studio, desk or hall inside one.
  Never call the tenant a "space" in code. There is no machine booking.
- Roles: Owner, Space manager (makerspace-wide settings: payments, refund tiers, taxes, rules, hours,
  notifications, branding, team), Bookings manager (spaces, pricing, availability, approvals), Front
  desk, Treasurer and Viewer. Every settings change writes a before/after audit row.
- Booking modes: free instant, free with approval, paid upfront, deposit, pay later (*payment pending*
  with a due date), and member vs public rates. Makerspace defaults can be overridden per space.
- Refunds: per-space policy tiers applied on member cancellation, plus manual staff refunds/overrides
  with a reason. Covers staff cancellation (100%), reschedule, no-show, partial, failed or duplicate
  payments, late or out-of-order webhooks, refund retry, offline refunds and the ledger.

## Status (2026-10-23)

**Done and committed on `dev`:** Phase 0 (platform fork, makerspace rename, magic link, roles, BullMQ
worker and beat, baseline migration). Also the ops track merged from `phase/ops`: installer menu,
private-repo access, Render Blueprint, DigitalOcean spec, compose smoke checks and deployment docs.

**Phase 1 (done, 2026-10-24):** the domain layer (`lib/{availability,bookingRules,bookings,pricing,ics,members,
spaces,time}`, settings audit, `0002_bookings`), the Server Actions (`app/actions/{booking-settings,spaces,
space-calendar,members,bookings-staff,bookings-public,booking-availability}.ts`, shared inputs in `lib/actions/`),
the staff dashboard (booking rules, hours, spaces with pricing/availability/rules/refund tiers, members, bookings
list and detail, new staff booking, Today day sheet, staff ICS feed), the customer side (spaces on `/m/[slug]`,
space page with availability and live quote, manage page with cancel/reschedule/ICS/check-in code, find my
booking, `/account/bookings` with a personal feed), branded booking emails with ICS, and a demo seed with four
spaces, front desk (`front@demo.test`) and a customer (`customer@demo.test`). Paid bookings stop at the Phase 1
boundary: HELD awaiting payment, REQUESTED, or pay-later CONFIRMED with a due date; taking money is Phase 2.
Gates on that commit: lint, typecheck, 834 unit, 118 integration, 15 e2e (no skips), builds, catalog, no drift.

## What is left

Phases 1 (finish) to 5 from the build plan:
1. Finish Phase 1: Server Actions and UI for settings, spaces, pricing, availability calendar and the
   booking flow (public, guest, member, staff, recurring, holds, approval, check-in, no-show,
   reschedule, ICS and emails).
2. Payments and refunds (every scenario), ledger, receipts, reconciliation, and the free/paid matrix tests.
3. Dashboard, calendar, reports, exports, audit, members, API keys, REST API, webhooks.
4. README with real screenshots, e2e suite, design polish and demo seed. The ops part is already done.
   Its open questions are in `docs/plans/ops-notes.md`, and a real Render deploy has not been tried.
5. Independent review passes, then open the `dev → main` PR for the owner.

## Run it locally

`cp .env.example .env`, then `npm ci && npm run db:migrate && npm run db:seed-demo && npm run dev`.
Checks: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration` (needs
Postgres), `npm run test:e2e`.
