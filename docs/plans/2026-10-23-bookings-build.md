# Space Works Bookings build plan (v1, 2026-10-23)

> **Superseded in part:** the roles below (owner, space manager, treasurer) were replaced on 2026-10-24 by a
> single top role, the bookings manager, plus front desk and viewer. `docs/DECISIONS.md` records this and every
> later owner decision, and wins where the two disagree.

Phase 0 and the Phase 1 domain layer were built by Claude Code alone. From 2026-10-23 the owner brought in Codex
(gpt-6.1-sol) for the Phase 1 actions and UI and for reviews; from 2026-10-24 the rest (Phases 2 to 5) was built and
reviewed by Claude Code again. Work happens in phases; each phase ends with green lint, typecheck, unit, integration
and end-to-end tests, a commit on `dev`, and a push once the owner has checked it. `main` is never touched.

Research notes (read them, they are the porting basis):

- `docs/plans/research/survey-django.md`: the Django booking + payments domain (what to port, bugs not to repeat).
- `docs/plans/research/survey-ops.md`: ops, BullMQ, auth and tests across Organization (O), Workspace (W), Events (E).

Reference repositories (read only): [SpaceWorks](https://github.com/SpaceWorks-Labs/SpaceWorks),
[SpaceWorks-Organization](https://github.com/SpaceWorks-Labs/SpaceWorks-Organization),
[SpaceWorks-Workspace](https://github.com/SpaceWorks-Labs/SpaceWorks-Workspace),
[SpaceWorks-Events](https://github.com/SpaceWorks-Labs/SpaceWorks-Events) and
[SpaceWorks-Design](https://github.com/SpaceWorks-Labs/SpaceWorks-Design); clone them beside this one.

## Product

A self-hostable (AGPL-3.0-or-later), multi-tenant platform for booking a makerspace's **spaces**: rooms,
studios, desks and halls. No machine booking. One install runs several **makerspaces** (the tenant). Fully
standalone: its own accounts, its own REST API with API keys, and outbound webhooks so other Space Works apps
can be linked later.

Words: **makerspace** = tenant. **Space** = a bookable thing inside a makerspace (kind ROOM, STUDIO, DESK,
HALL, OTHER). Never call the tenant a "space" in code.

## Owner requirements (all must hold)

1. Every flow works **free or paid**: free instant, free with approval, paid upfront, deposit, pay later
   (shown as *payment pending* with a due date), member vs public rates. Makerspace-level defaults, each
   overridable per space. Every combination is tested with Razorpay, Stripe and offline (providers mocked).
2. **Nothing hardcoded.** Settings areas gated by RBAC with sensible defaults and an audit row (before/after)
   for every settings change:
   - **Space manager** (`SPACE_MANAGER`): whole-makerspace settings — payments and providers, refund policy
     tiers, taxes, booking rules defaults, default opening hours, notifications, branding, team roles.
   - **Bookings manager** (`BOOKINGS_MANAGER`): spaces, pricing, availability (hours, blackouts), approvals.
3. Refunds for every scenario (see "Money").
4. README in the Events/Workspace style with hero art, a feature overview and **real Playwright screenshots**
   (light and dark) under `docs/screenshots/`; a one-line VPS install
   (`curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Bookings/main/install.sh | bash`,
   plus a `gh`/token fallback because the repo is private); a working `render.yaml` with a Deploy to Render
   button, plus the other hosts the siblings document.
5. Design follows SpaceWorks-Design strictly, the same way Organization applies it (tokens, Gilroy, pills,
   Patch, light and dark). Booking-specific touches: icons, empty states, calendar, illustrations.

## Base and renames (Phase 0)

Fork the Organization platform (O) and keep its conventions (CLAUDE.md "Conventions"): tenant isolation in the
application with composite FKs, integer minor units, gapless receipt numbers, immutable money rows with
triggers, 300-line file limit, en-GB sentence-case copy, `lib/views/*` loaders + the `frontend/` split image.

| From (O) | To |
|---|---|
| `Organisation`/`organisation(s)`/`organisationId` | `Makerspace`/`makerspace(s)`/`makerspaceId` |
| `Org*` identifiers (`OrgPaymentSettings`, `requireOrgTeam`) | `Makerspace*` |
| `orgSlug`, `[orgSlug]` | `makerspaceSlug`, `[makerspaceSlug]` |
| capability `org.*` | `makerspace.*` |
| `Space Works Organization`, `spaceworks-organization` | `Space Works Bookings`, `spaceworks-bookings` |
| `SWO_`, `swo.`/`swo:`, `sworg` | `SWB_`, `swb.`/`swb:`, `swbook` |
| public `/o/[orgSlug]`, `/organisations` | `/m/[makerspaceSlug]`, `/makerspaces` |

Strip: membership (plans, members, terms, member roles, units, join forms, member invites, renewals),
member cards and `/verify`, the public page editor, ledger/accounts, Google Sheets, Google/GitHub/Apple
sign-in (no SSO), member refund requests, membership reports and digests, membership seeds.

Keep: auth (password, TOTP MFA + recovery codes, known devices, IP block, breached passwords, email
verification, password reset), super admin, makerspace applications/lifecycle, team + invites, audit,
outbox + email (per-makerspace SMTP), chat alerts, storage (Silo/S3), rate limits, theme, UI kit, brand,
Patch, payment infrastructure (gateway adapters, secrets, settings, tax, numbering, documents/PDF, webhook
verification), report engine + charts, account data export, ops (Docker, compose, Caddy, install, scripts).

Add in Phase 0:

- **Magic link sign-in**: emailed single-use link (token hashed in `VerificationToken`, 15 min), consumed by a
  Credentials provider; still asks for TOTP when the account has MFA; rate limited; IP block aware.
- **Roles**: `OWNER`, `SPACE_MANAGER`, `BOOKINGS_MANAGER`, `FRONT_DESK`, `TREASURER`, `VIEWER` with a capability
  map (draft below). Staff need an authenticator, as in O.
- **BullMQ worker + beat** from W replacing O's `scheduler` role (`lib/queue/*`, `lib/scheduled/index.ts`,
  `scripts/queue/*`, `scripts/build-jobs.mjs`, `/api/internal/jobs`, Docker roles `worker`/`beat`, compose and
  render services, queue tests). Prefix `swb:jobs`.
- `VERSION` 0.1.0, fresh CHANGELOG, NOTICE crediting O/W/E with their SHAs.

Capabilities (draft; Phase 0 defines, later phases use):

| Capability | Roles |
|---|---|
| `makerspace.view` | all |
| `makerspace.settings` (general, branding, rules defaults, hours, notifications, email) | OWNER, SPACE_MANAGER |
| `makerspace.delete` | OWNER |
| `team.manage` | OWNER, SPACE_MANAGER |
| `payments.settings` (providers, tax, refund tiers, pay-later defaults) | OWNER, SPACE_MANAGER |
| `spaces.manage` (spaces, pricing, add-ons, hours, blackouts, per-space overrides) | OWNER, SPACE_MANAGER, BOOKINGS_MANAGER |
| `bookings.view` | all |
| `bookings.manage` (create on behalf, reschedule, cancel, check-in, no-show) | OWNER, SPACE_MANAGER, BOOKINGS_MANAGER, FRONT_DESK |
| `bookings.approve` | OWNER, SPACE_MANAGER, BOOKINGS_MANAGER |
| `bookings.contact` (see customer email/phone) | all but VIEWER |
| `payments.view` | OWNER, SPACE_MANAGER, BOOKINGS_MANAGER, TREASURER, FRONT_DESK |
| `payments.record` (offline payments) | OWNER, SPACE_MANAGER, TREASURER, FRONT_DESK |
| `refunds.manage` (manual refunds, overrides, retries) | OWNER, SPACE_MANAGER, TREASURER |
| `members.manage` (member-rate list) | OWNER, SPACE_MANAGER, BOOKINGS_MANAGER |
| `reports.view` | all |
| `reports.finance` | OWNER, SPACE_MANAGER, TREASURER |
| `integrations.manage` (API keys, webhooks) | OWNER, SPACE_MANAGER |
| `audit.view` | OWNER, SPACE_MANAGER |

## Domain (Phase 1)

### Settings with overrides

`MakerspaceBookingSettings` (1:1, every field defaulted) holds the defaults; `Space` carries the same fields
as nullable overrides. One pure function `effectiveRules(defaults, space)` resolves them (unit-tested) and is
the only place that reads them.

Rule fields: approval (`INSTANT` | `APPROVAL`), whether requests block the slot, min/max duration, slot step,
lead time (minutes), advance window (days), buffer before/after, hold minutes (checkout lock, default 15),
guest booking allowed, member cancel cutoff (hours), member reschedule allowed + cutoff, self check-in window,
no-show grace (minutes) + auto no-show on/off, reminder hours before, charge mode, deposit, pay-later due rule,
overdue action, payment reminder offsets, no-show charge (`FULL` | `NONE`).

Charge mode: `FREE` | `PAY_NOW` | `DEPOSIT` | `PAY_LATER` | `CHOICE` (booker picks pay now or later).
Deposit: `PERCENT` (bps) or `FIXED` (minor), plus `depositRefundable`. Pay later due rule: `BEFORE_START`
(hours) or `AFTER_BOOKING` (days), whichever is earlier is never later than the start. Overdue action:
`AUTO_CANCEL` | `NOTIFY_STAFF`. With no online gateway connected, PAY_NOW/DEPOSIT degrade to pay later with
offline instructions (shown clearly).

### Spaces

`Space`: makerspaceId, slug, name, kind, summary, description (markdown rendered as React text), capacity
(people), units (identical bookable units, e.g. 8 hot desks; default 1), amenities (string list),
photos (`SpacePhoto`, ordered, Silo), published, archivedAt, sort order, colour token, plus the overrides.
`OpeningHours` rows (makerspaceId, spaceId null = makerspace default, weekday 0–6, openMinute, closeMinute;
several intervals per day; a space with any rows uses only its own). `Blackout` (spaceId null = whole
makerspace; startsAt, endsAt, reason). Times are stored UTC and evaluated in the makerspace timezone (DST-safe).

### Pricing (pure, `lib/pricing/*`, exhaustively unit-tested)

Rates per space: public and member, each with hourly, half-day (4h) and day (8h) prices (null = not offered;
member null = public). Price of one occurrence = cheapest combination of day, half-day and hourly blocks
(hourly billed per started slot step). Peak rules (`PeakRule`: weekdays, start/end minute, surcharge bps) add
`hourly rate × peak minutes × bps`. Add-ons (`AddOn`: per booking, per hour or per person; optional
member price; active flag). Discount: none in v1. Tax from `MakerspaceTaxSettings` (GST inclusive or
exclusive, CGST/SGST/IGST, SIMPLE, NONE) with a per-space rate/SAC override. Output = frozen lines + tax snapshot.

Member rate: the booker's verified account email (or, for staff bookings, the email typed) matches an active
`MakerspaceMember` (email, name, validUntil, note; managed in the dashboard, CSV import, API upsert).

### Bookings

- `Booking` (the order): reference `BK-XXXXXX` (unique per makerspace), space, status, customer (userId
  nullable + contact name/email/phone), attendees, purpose, internal notes, `rateKind`, chargeMode, currency,
  subtotal/tax/total/deposit minor, cached `paidMinor` and `refundedMinor` (maintained in the same transaction
  as the money row), `paymentDueAt`, `paymentState` (NOT_REQUIRED, UNPAID, DEPOSIT_PAID, PAID, OVERDUE,
  REFUNDED, PARTIALLY_REFUNDED, WRITTEN_OFF), price snapshot JSON, `holdExpiresAt`, manage token (hash only),
  source (PUBLIC, STAFF, API), createdById, approvedAt/By, decline reason, cancelledAt/By/kind (CUSTOMER,
  STAFF, VENUE, SYSTEM) and reason.
- `BookingOccurrence`: bookingId, spaceId, unit, startsAt, endsAt, blockStart, blockEnd (with buffers),
  `blocking` boolean, status (SCHEDULED, CHECKED_IN, NO_SHOW, CANCELLED, COMPLETED), checkedInAt/By,
  noShowAt, priceMinor (its share), reminderSentAt. Recurring bookings (daily/weekly, until or count ≤ 52)
  are one Booking with several occurrences; conflicts are listed and the booker may skip them.
- **Double booking is impossible at the database**: `btree_gist` +
  `EXCLUDE USING gist ("spaceId" WITH =, "unit" WITH =, tstzrange("blockStart","blockEnd") WITH &&) WHERE ("blocking")`.
  Units are allocated lowest-free-first inside the transaction; a 23P01 becomes "That time was just taken".
- Statuses: `HELD` → `REQUESTED` (approval) | `CONFIRMED`; `REQUESTED` → `CONFIRMED` | `DECLINED`;
  `HELD` → `EXPIRED`; `REQUESTED`/`CONFIRMED` → `CANCELLED`. Completed/no-show live on occurrences.
- Holds: checkout creates a HELD booking whose occurrences block; expired holds are released in the same
  transaction before any insert for that space and by a beat job every minute.
- `BookingEvent` timeline (append-only): every transition, reschedule, check-in, payment and refund, with
  actor and data. Also an `AuditEvent` for staff actions.
- Approval re-checks every rule (Django skipped lead time / window / duration on approval: don't).
- Staff bookings on behalf (any customer, may override rules with a reason, may mark as member rate when the
  email matches, may choose pay later or record offline payment at once).
- Check-in: staff from the day sheet or by scanning the booking QR (manage URL); optional self check-in
  within the window. No-show: staff after start + grace, or the auto no-show job.
- Reschedule: staff any time; customers up to the cutoff when allowed. Repriced; difference charged or
  refunded (see Money). Payment due date moves with the start.
- Notifications through the outbox: received, confirmed, request received/approved/declined, reminder,
  payment due / overdue, cancelled (with refund amount), rescheduled, refund processed/failed, receipt. Every
  confirmation carries an ICS attachment (METHOD:REQUEST, stable UID, SEQUENCE bumped on reschedule,
  METHOD:CANCEL on cancel). Personal and staff ICS feeds via secret URLs.

## Money (Phase 2)

O's Payment/PaymentLine/Refund/TaxDocument/DocumentCounter/ProcessedWebhookEvent re-pointed at Booking.
Payment `purpose`: FULL, DEPOSIT, BALANCE, DIFFERENCE, NO_SHOW_FEE. Plus an append-only `MoneyEvent` ledger per
booking (trigger forbids UPDATE/DELETE): every charge, attempt, capture, offline record, waiver, write-off,
refund request/process/fail/retry, with actor, signed amount and balance after.

Refunds are never edited; a retry is a new row with `retryOfId`. Kinds and rules:

| Scenario | Rule |
|---|---|
| Customer cancels | Policy tiers of the space (else makerspace default): first tier whose `minHoursBefore` ≤ hours until the first cancelled occurrence; refund = bps × refundable paid amount for the cancelled share (deposit kept when not refundable). Automatic. |
| Staff/venue cancels | Always 100% of everything paid. Automatic. |
| Staff manual refund / override | Any amount ≤ refundable, mandatory reason, `refunds.manage`. Override of the policy on cancel likewise. |
| Reschedule | New price − old price: positive → DIFFERENCE payment (pay now or added to pay-later due); negative → RESCHEDULE refund of the overpaid part. |
| No-show | No-show charge FULL keeps money / leaves balance due; NONE waives the balance; optional staff refund with reason. |
| Partial refund | Any amount up to refundable. |
| Failed payment | Attempt FAILED; booking stays HELD until expiry, retry allowed; pay-later stays due. |
| Duplicate payment | Second capture on a fully paid booking → auto DUPLICATE refund of the extra. |
| Late capture | Capture after the hold expired: re-block if still free and confirm (flagged), else auto LATE_CAPTURE full refund. |
| Webhook late / out of order | Idempotent by event id; terminal states never regress; refund events for unknown refund ids create an EXTERNAL refund (flagged); reconcile job polls open attempts and pending refunds. |
| Refund failure | FAILED with reason; staff retry (new row) or record as offline with reference. |
| Offline refund | Recorded with method and mandatory reference; processed at once with credit note. |
| Pay-later cancelled before paying | Nothing refunded; balance voided (WRITTEN_OFF), event logged. Deposit paid → policy applies to it. |
| Overdue pay-later | AUTO_CANCEL (system cancel, deposit per policy) or NOTIFY_STAFF (flag + email); reminders before due. |

Receipts / tax invoices per payment and credit notes per processed refund (O's gapless numbering). A booking
"invoice" PDF (unnumbered statement of charges, payments and balance) is always available.
Reconciliation page: open attempts, flagged payments, pending/failed refunds, daily totals per provider.

## Admin, reports, integration (Phase 3)

Dashboard overview (today's day sheet, pending approvals, payments due/overdue, KPIs), calendar (day/week per
space), reports (utilisation = booked minutes / open minutes per space, revenue, refunds, no-shows, payment
methods) with CSV exports, audit log. REST API `/api/v1` with API keys (hashed, prefix shown once, scopes
`read`/`write`, per makerspace, last used, revoke) and an OpenAPI document; outbound webhooks
(`WebhookEndpoint` + `WebhookDelivery`, HMAC-SHA256 `t=,v1=` header, BullMQ delivery with exponential backoff,
`assertPublicHost`, test ping, delivery log).

## Phases

0. Platform fork, renames, strip, magic link, roles, BullMQ. Green.
1. Settings + spaces + pricing + availability + booking flow (public, guest, member, staff, recurring, holds,
   approval, check-in, no-show, reschedule, ICS + emails).
2. Payments and refunds (all scenarios above), ledger, receipts, reconciliation, free/paid matrix tests.
3. Dashboard, calendar, reports, exports, audit, members list, API keys, REST API, webhooks.
4. Ops (install.sh menu, compose, render, smoke), docs (README with screenshots, CLAUDE.md = AGENTS.md),
   e2e suite, design polish (impeccable audit), seed demo data.
5. Independent review passes until nothing is open; final report.

## v2 amendments (independent plan review, 2026-10-23) — these OVERRIDE anything above

Concurrency
- **Lock order everywhere:** Booking → its Payments (by id) → Refunds → DocumentCounter. Webhooks look up the
  bookingId unlocked, then lock the Booking first. No Space row lock.
- **Inserting occurrences** takes `pg_advisory_xact_lock(hashtext('space:' || spaceId))`, then allocates the
  lowest free unit (same unit across a series when possible); the exclusion constraint stays as the backstop and
  23P01 still maps to "That time was just taken". Hold sweeps use `FOR UPDATE SKIP LOCKED` and re-check status.
  Integration test with parallel inserts.
- `blocking` is changed only through `setBookingStatus`/occurrence helpers; `CHECK (NOT blocking OR status IN
  ('SCHEDULED','CHECKED_IN'))`. HELD and CONFIRMED block; REQUESTED blocks per setting. Setting
  `noShowReleasesSlot`. Occurrence carries makerspaceId and spaceId; `(bookingId, spaceId)` references
  `Booking(id, spaceId)` ON UPDATE CASCADE (a staff room move updates the booking). CI/test asserts
  `prisma migrate diff` shows no drift.

Settings
- Space overrides live in one zod-validated `ruleOverrides Json` (key present = overridden, so "explicitly none"
  is expressible). Opening hours, hour exceptions and refund tiers override as whole sets. `effectiveRules`
  returns each value with its source (`makerspace` | `space`) so the UI shows "Inherited".
- No hardcoded values: half-day and day block lengths are per-space rate fields (defaults 240/480 min);
  recurrence max occurrences, request expiry, hold minutes, pay-later minimum window are settings.
- Every settings write goes through `saveSetting(tx, {area, targetType, targetId, before, after, actorUserId})`
  which writes an AuditEvent with a field diff (secrets redacted). A test enumerates settings actions and
  asserts each writes an audit row.

Approval and money
- **No money before approval.** On approve, PAY_NOW/DEPOSIT become due within `approvalPayWithinHours`
  (overdue → AUTO_CANCEL); PAY_LATER follows its rule. REQUESTED auto-expires after `requestExpiryHours` and
  hard-stops at start − lead time.
- Charge modes: `FREE`, `PAY_NOW`, `DEPOSIT`, `PAY_LATER`, plus `allowPayLater` (booker may choose pay later on
  PAY_NOW/DEPOSIT spaces). No CHOICE mode, no NO_SHOW_FEE purpose.
- **Drop MoneyEvent.** Payment/Refund rows are the ledger; BookingEvent is the timeline. Booking keeps
  `chargeMinor` (current obligation, written by the app on every change) and `paidMinor`/`refundedMinor` caches
  **maintained by DB triggers** on Payment/Refund, plus a consistency check test/job. Payment state is a pure
  function of (charge, paid, refunded, dueAt, now) — OVERDUE is never stored.
- **Obligation model** (one formula for every scenario): cancelling an occurrence keeps a fee
  `(1 − tierBps(hours from policyAnchorAt to now)) × occurrencePrice`; `charge = live occurrences + kept fees +
  booking-level add-ons`; non-refundable deposit is a floor `charge ≥ min(deposit, paid)`;
  `refundDue = max(0, netPaid − charge)`, `balanceDue = max(0, charge − netPaid)`. Venue cancel keeps no fees.
  Unpaid late cancel owes the fee only if setting `chargeLateCancelWhenUnpaid` (default off → balance VOID).
  Occurrence prices (with tax) are split by largest remainder so they sum exactly.
- `policyAnchorAt` = earliest start an occurrence ever had; tiers and reschedule price reductions use it (no
  escaping the policy by rescheduling). Reprice at current rates but keep `rateKind` and tax snapshot.
- Payment state words: NOT_REQUIRED, UNPAID, PARTIALLY_PAID, PAID, OVERDUE (derived), VOID (cancelled before
  paying), WRITTEN_OFF (staff action with reason, `refunds.manage`), REFUND_DUE, REFUNDED.
- **Refund allocator** (pure): a booking refund splits into per-payment Refund rows newest payment first,
  gateway before offline, falling back to offline when a provider can't refund; rows share `refundGroupId`.
- Documents: each payment gets a RECEIPT (titled "Receipt voucher" under GST, tax from that payment's lines);
  each processed refund gets a REFUND_VOUCHER (GST) / CREDIT_NOTE (otherwise). Decide and document in GST.md.
- Webhooks: match refunds by our refund id in notes/metadata first, then gateway id; EXTERNAL refunds are only
  created by the reconcile job after ~30 min, flagged. Gateway calls caused by webhooks (auto refunds) run via
  BullMQ after commit.
- Holds vs gateway sessions: starting an attempt extends the hold to at least the gateway minimum (Stripe 30
  min); on hold expiry expire the Stripe session / close the attempt; Razorpay Checkout uses `timeout`. Late
  capture on EXPIRED → re-block if free and confirm (flagged) else auto-refund; on CANCELLED/DECLINED →
  auto-refund.
- Pay-later due = `max(now + payLaterMinWindowHours, min(ruleDue, firstStart))`; inside
  `payLaterMinLeadHours` of the start pay later isn't offered (pay now / at desk). Recurring pay later: one due
  date from the first occurrence; staff may change the due date (audited).

Time
- OpeningHours allow 24:00; bookings may cross midnight when consecutive intervals cover them.
  `HoursException` (date, closed or special intervals; makerspace or space). Full-day blackouts are local date
  ranges; timed blackouts are instants. DST: openings take the first fold, closings the last; a recurrence in a
  missing hour is a conflict. Price on elapsed minutes; peak rules per local-time segment. Advance window
  applies to the end time. Changing a makerspace timezone with future bookings is refused.

Pricing
- Peak surcharge base = hourly rate, else day rate ÷ day minutes × 60. Member price never exceeds public.
  Rounding half-up per line in minor units. Per-person add-ons reprice when attendees change. Tax per line with
  its SAC (space or add-on).

RBAC
- Per-space money overrides (charge mode, deposit, pay later, refund tiers, tax/SAC) need `payments.settings`.
  Makerspace-wide hours, exceptions and blackouts need `makerspace.settings`; per-space ones `spaces.manage`.
- `bookings.manage` (FRONT_DESK) cancels for the customer (policy applies). New `bookings.override` (venue cancel
  at 100%, rule overrides) = OWNER, SPACE_MANAGER, BOOKINGS_MANAGER; refund amount overrides need `refunds.manage`.

Other
- Check-in uses a separate code (reference + HMAC), never the manage URL.
- ICS UID per occurrence with SEQUENCE; `ReminderLog` unique on (occurrenceId, kind, startsAt).
- Recurring: booking CANCELLED when all occurrences cancelled; cancel "this" or "this and following"; series
  approved as a whole; member `validUntil` checked per occurrence.
- `quantity` (≤ units) books N identical units (N occurrence rows per slot); reducing `units` below what
  future bookings use is refused.
