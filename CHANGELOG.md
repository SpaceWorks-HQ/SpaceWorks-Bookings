# Changelog

Releases are published from `main` and titled **`Space Works Bookings <version>`**. The root `VERSION`
file selects the series; each build is tagged `v<series>-main.<run>.<sha>`, which is what a deployment pins
to. Pushes to `dev` publish staging images tagged `dev` without a release.

## 0.1.0 (unreleased)

The platform Space Works Bookings is built on (Phase 0 of `docs/plans/2026-10-23-bookings-build.md`).

- **Forked from the Space Works membership platform** (see `NOTICE`) at `bc71613`, keeping its accounts, multi-tenancy, payments, receipts,
  outbox, storage and operations, and renamed for bookings: the tenant is a **makerspace** (`/m/<slug>`,
  `/makerspaces`), the product is `spaceworks-bookings`, and prefixes are `SWB_`, `swb.`/`swb:` and `swbook`.
- **Membership removed:** plans, members, terms, units, member roles, join forms, invites, renewals, member cards
  and `/verify`, the public page editor, ledger and accounts, Google Sheets, refund requests and membership
  reports. The public makerspace page is a minimal profile (name, logo, description, contact) for Phase 1 to extend.
- **Payments decoupled:** the gateway adapters, settings, tax, numbering, receipts and credit notes stay. A payment
  carries the customer's name, email, state and GSTIN and a placeholder `bookingId`; settling no longer activates
  anything. The default SAC is 997212 (renting non-residential space).
- **No single sign-on.** Google, GitHub and Apple sign-in are gone, with their settings and tables.
- **Sign in with an emailed link.** A one-time link (15 minutes, stored only as a hash) from the sign-in page; it
  still asks for the authenticator when the account has one, verifies the email, never reveals whether an
  account exists and is refused for super admins.
- **Bookings roles:** owner, space manager, bookings manager, front desk, treasurer and viewer, with the capability
  map from the build plan. Owners manage everyone; space managers manage less senior roles.
- **BullMQ worker and beat** replace the scheduler: queued outbox delivery, payment and refund reconciliation,
  retention and a heartbeat from one job registry (`lib/scheduled`), new Docker roles `worker` and `beat`, compose
  and Render services, health probes, a super-admin Jobs page, and `JOBS_INPROCESS` for Redis-free development.
- **One baseline migration** (`0001_init`) with the money immutability triggers, CHECK constraints and partial
  unique indexes.
- **Demo seed:** the Tinkerspace makerspace and its owner (`npm run db:seed-demo`).
