# Changelog

Releases are published from `main` and titled **`Space Works Bookings <version>`**. The root `VERSION`
file selects the series; each build is tagged `v<series>-main.<run>.<sha>`, which is what a deployment pins
to. Pushes to `dev` publish staging images tagged `dev` without a release.

## 0.5.1 - 2026-10-29

- Reserve checkout attempts transactionally and close delayed provider orders after cancellation.
- Enforce reviewed net payment thresholds and consistent booking/payment/refund lock order.
- Preserve booking, repair and financial history when removing a makerspace.
- Pin validated outbound addresses and bound streamed API request bodies.
- Provide the complete supervised local PostgreSQL, Redis, Silo and Mailpit stack.
- Reject failed scheduled database dumps/compression before publication or retention, and keep partial restores offline.
- Recover data services before serving traffic and resume backup schedules only after restored app checks pass.
- Preserve TLS certificate permissions in configuration backups so recovered non-root services can read their public CA.
- Remove global npm/npx tooling from final runtime images while retaining isolated Node-based migration and operator tools.
- Pin Silo and its standalone storage client to the October 26, 2026 release and immutable multiarch digests.
- Build the security-patched Caddy edge locally during setup and upgrades, including published-app installs; existing proxies skip it.

## 0.5.0

The first public release: bookings, money, integrations, repairs, the finance ledger and the ship work (Phases 1 to 4
of `docs/plans/2026-10-23-bookings-build.md` and the owner decisions in `docs/DECISIONS.md`).

- **Spaces and rules.** Rooms, studios, desks and halls with photos, capacity, units, amenities, hourly, half-day
  and day rates, member rates, peak rules, add-ons and a SAC; opening hours, exceptions and blackouts per makerspace
  or per space; every booking rule a makerspace default that a space can override, each change audited.
- **Booking.** Public makerspace and space pages with live availability and quotes, guests or signed-in customers,
  recurring bookings, holds, approvals, check-in by button or code (or by the customer, when the space allows it),
  no-shows, reschedules, moves, a manage link per booking, branded emails with calendar invites, personal and team
  calendar feeds. Double bookings are refused by the database.
- **Money.** Payments linked to bookings (full, deposit, balance, difference) through Razorpay Checkout, Stripe
  Checkout, the desk or pay later; trigger-kept paid and refunded totals; refunds for every case in the build plan
  (policy tiers, venue cancellations, cheaper reschedules, duplicate and late captures, provider-dashboard refunds,
  retries, offline refunds); due dates, reminders and auto-cancel; booking statements; a reconciliation page
  (`0003_booking_money`).
- **Running it.** An overview of the day, a calendar by day or week, reports on utilisation, bookings, no-shows,
  money and refunds with audited CSV exports, and the makerspace audit log.
- **Integrations.** A REST API (`/api/v1`) with read and write keys and an OpenAPI document, and signed webhooks
  relayed from the booking timeline with retries and a delivery log (`0004_integrations`, `docs/API.md`).
- **Roles.** The bookings manager is the top role with every capability, deleting the makerspace included; front
  desk, viewer and technician (repairs only) remain. Owners and space managers became bookings managers and
  treasurers viewers (`0005_manager_roles`); a makerspace always keeps one bookings manager. Decisions moved to
  `docs/DECISIONS.md`.
- **Repairs.** Staff and customers report problems with a space (severity, photos); a technician directory of team
  technicians and outside contacts with skills; requests sent to the chosen technicians by email, WhatsApp or
  Telegram, the first to accept takes it, outside technicians work through a private link; fix remarks, parts and
  the amount asked; verify, close or reopen; spaces blocked while out of service; approved amounts paid out in
  cash, by bank transfer or UPI; repair spend in reports and exports; chat alerts and webhooks
  (`0006_repairs_finance`).
- **Finance ledger.** Every payment, refund and repair payout posts itself to an append-only ledger in its own
  transaction (history backfilled), plus hand-posted income and expenses and reversals; a Finance page with money
  in, out and net by period, category, way of paying and space, CSV and Excel exports, an hourly consistency check
  and a `finance.entry_posted` webhook. Finance is the bookings manager's alone.
- **Calmer dashboard.** Sidebar groups, overview, Today, report and finance sections and the secondary parts of booking
  and issue pages fold away; empty ones start folded and each choice is remembered in the browser. The dark-mode
  reveal switches colours at once inside the circle and starts after the account menu has closed.
- **Changed: a page-by-page polish.** Every control is a 44px target (a `sw-hit` area where the control stays
  compact); long tables (ledger, audit log, payments, issues, super-admin lists) keep their header in view and
  scroll inside their box on a phone; the week calendar keeps the space column pinned, truncates with titles and
  marks today in a contrast-safe colour; booking, arrival and member rows stack on a phone instead of squeezing;
  amounts in stat tiles shrink to fit and never wrap after the minus sign; rates, add-ons, tax, surcharges and
  refund tiers are typed in the currency or as a percentage instead of minor units and basis points; empty states
  no longer sit inside a second border, a single page has no pager, dropdowns without a value say "Choose one",
  the makerspace breadcrumb is a real breadcrumb, settings tabs share one title, an expired email link offers a way
  back to sign in, a space with one unit asks for no quantity, and leftover Google sign-in wording is gone. The
  sidebar no longer squeezes the makerspace switcher on short windows. The colour reveal switches transitions off
  inside the view-transition update (a production build could capture a blank old page), and choosing the mode
  from the account menu with the mouse leaves no focus ring behind.
- **Ship.** README in the Space Works layout with light and dark screenshots, a demo with payments, three booking
  easter eggs, the colour-mode reveal from the control that changed it, a phone layout fix on public pages, and the
  operations checks recorded in `docs/plans/ops-notes.md`.

## 0.1.0

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
