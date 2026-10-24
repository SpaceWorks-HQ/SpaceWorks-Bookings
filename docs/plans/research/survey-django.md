# SpaceWorks (Django) — Space Booking + Payments Domain Spec

Source repo: `scratchpad/ref/SpaceWorks` (paths below are relative to it). Read-only survey, 2026-10-23.
Scope: `backend/apps/bookings` (space booking only), `backend/apps/payments`, `backend/apps/payments_rail`,
the bits of `makerspaces`/`accounts`/`operations` they depend on, and `frontend/src/features/{bookings,staff,members,payments}`.

---

## 0. Headline facts (read first — these shape the port)

1. **There is NO pricing engine.** A space has one flat `payment_amount` (Decimal) charged **once per booking**, regardless of
   duration. No hourly/daily rates, no member-vs-public price, no peak/off-peak, no add-ons, no coupons, no tax/GST.
   (`bookings/models_spaces.py`, `bookings/service_payments.py`). `PaymentDocument.tax_breakdown` is DB-constrained to NULL
   (`document_tax_unused`), i.e. tax is explicitly unimplemented (`payments/models_documents.py`).
2. **Pay-later model.** Payment never gates confirmation. A booking is CONFIRMED (instant) or PENDING→CONFIRMED (approval);
   a `Payment` (status `pending`, `due_at = booking.starts_at`) is raised only when the booking becomes CONFIRMED, and a hosted
   checkout link is created after commit. Payment failures are swallowed (`service_payments.create_for_confirmed_booking`
   wraps everything in `try/except Exception: return None`). There are no slot holds/reservations-pending-payment.
3. **Booking requires sign-in.** Public pages are browse-only; `POST .../book/` is `IsAuthenticated` and the booking is always
   owned by `request.user` (`member=request.user`); name/email/phone are copied from the user, not typed.
4. **A space is exclusive**: at most one CONFIRMED booking may occupy any instant (+buffers). `capacity` is informational only.
5. **Double-booking prevention = row lock**, not a DB constraint: every booking write takes `SELECT ... FOR UPDATE` on the
   `BookableSpace` row, then checks overlap against CONFIRMED rows. PENDING bookings do not block anything.
6. **Opening hours / blackouts are makerspace-wide** (JSON on `Makerspace.opening_hours`), not per space.
7. **Payments are a generic ledger** keyed by `(makerspace, subject_type, subject_id)`; booking is one subject type
   (`"booking"`). Ledger rows are immutable once terminal, enforced by Postgres triggers.
8. Providers: **Stripe** (Checkout Sessions; raw keys or Stripe Connect w/ application fee) and **Razorpay** (Payment Links;
   own account only). Plus a Stripe-only native PaymentIntent rail for mobile.

---

## 1. Models

### 1.1 `BookableSpace` — `backend/apps/bookings/models_spaces.py`
| field | type | notes |
|---|---|---|
| id | auto int PK | |
| public_token | UUID, unique, indexed, default uuid4, immutable (re-read in `save`) | used in public URLs |
| makerspace | FK Makerspace CASCADE (`bookable_spaces`), immutable after create | tenant |
| name | varchar(200), stripped, non-blank (raises in `save`) | |
| kind | varchar(16) enum `dev_room \| bench \| meeting \| other` default `other` | |
| description | text blank | |
| capacity | PositiveInt default 0 | informational only |
| location | varchar(255) blank | |
| image_key | varchar(500) null | S3 object key, public bucket |
| is_public | bool default False | listed on public page |
| show_public_availability | bool default False | publish busy windows |
| show_public_booker_names | bool default False | requires availability=True (`BookerNamesRequiresAvailability`, 400) |
| approval_mode | varchar(16) enum `instant \| approve`; **model default `approve`**, service `create_space` default `instant` | |
| custom_form | JSON null, `validate_form_schema` | per-space extra questions; answers validated by `forms_schema.validation.validate_answers` |
| requester_notifications_enabled | bool **nullable** (tri-state) | null ⇒ inherit `Makerspace.booking_requester_notifications_enabled` (default False) |
| payment_amount | Decimal(12,2) ≥0 default 0 | flat per-booking charge; 0 ⇒ no charge |
| min_booking_duration_minutes | PositiveInt default 30, ≥1 | |
| max_booking_duration_minutes | PositiveInt default 480, ≥1, ≥min | |
| booking_lead_time_minutes | PositiveInt default 60 | earliest start = now + lead |
| buffer_before_minutes | PositiveInt default 0, ≤1440 | setup |
| buffer_after_minutes | PositiveInt default 0, ≤1440 | cleanup |
| cancellation_cutoff_hours | PositiveInt default 0, ≤8760 | member cancel/reschedule cutoff |
| max_booking_advance_days | PositiveInt default 30, ≥1 | latest start = now + N days |
| is_active | bool default True | soft delete ("deactivate"); inactive ⇒ no create/approve/update/image |
| machine_type | FK machines.MachineType SET_NULL null, `related_name="+"` | optional certification gate (machine domain; ignore for pure space port) |
| created_by | FK User SET_NULL null | |
| created_at / updated_at | auto | |

Constraints: `bookspace_capacity_nonnegative`, `bookspace_min_duration_positive` (min≥1), `bookspace_max_duration_gte_min`,
`bookspace_advance_positive` (≥1), `bookspace_payment_nonnegative`.
Indexes: `(makerspace, is_active, name)`, `(makerspace, is_public, is_active)`.
Service-level upper bounds (`services_rules.py`): durations ≤ 43200 min (30 d), lead ≤ 525600 min (1 y), advance ≤ 3650 d — to
avoid datetime overflow.

### 1.2 `Booking` — `backend/apps/bookings/models_booking.py`
| field | type | notes |
|---|---|---|
| id | auto PK | staff APIs use id |
| space | FK BookableSpace CASCADE (`bookings`), immutable after create | |
| public_token | UUID unique indexed, immutable | member APIs + ICS UID use this |
| name / email / phone | **TextField** (encrypted per-tenant PII via `ScopedPiiModelMixin`; `encryption/registry.py` also encrypts `note`) | stripped; email lowercased; all three required non-blank (raises in `save`) |
| member | FK User SET_NULL null (`bookings`) | always set in current flows |
| starts_at / ends_at | timestamptz | must be tz-aware (naive rejected) |
| status | varchar(16) enum (see §2.1), model default `confirmed` | |
| note | text blank | staff booking only |
| custom_answers | JSON null | validated against space.custom_form |
| calendar_sequence | PositiveInt default 0 | ICS SEQUENCE; ++ on every status/time change |
| calendar_updated_at | datetime default now | ICS DTSTAMP/LAST-MODIFIED |
| created_at | auto | |

Constraint: `booking_end_after_start` (ends_at > starts_at).
Indexes: `(space, status, starts_at)` `booking_space_status_idx`; `(space, ends_at)` `booking_space_end_idx`.
Ordering `starts_at, id`. **No exclusion constraint, no series/recurrence FK, no check-in fields, no price snapshot on booking.**

### 1.3 `BookingCalendarFeed` — `backend/apps/bookings/models_feed.py`
Per-(makerspace,user) private ICS capability. `token_digest` Binary(32) unique (sha256 of raw token), `token_hint` char(8)
(last 8 chars), `created_at`, `rotated_at` null, `revoked_at` null. Unique `(makerspace, user)`.

### 1.4 Makerspace fields used (`backend/apps/makerspaces/models_makerspace_core.py`, `profile_validation.py`)
- `timezone` IANA string; `opening_hours` JSON (format §3.2); `booking_requester_notifications_enabled` bool default False;
  `booking_reminder_lead_hours` JSON list[int] default `[24]` (1..8760, ≤100 unique; `[]` disables) (`makerspaces/reminder_policy.py`).

### 1.5 `Payment` — `backend/apps/payments/models_payment.py`
| field | type | notes |
|---|---|---|
| makerspace | FK PROTECT | owner/merchant |
| subject_type | varchar(48) enum: `machine_service_request, booking, event_registration, makerspace_membership, membership_term, membership_request, loan_deposit, loan_late_fee` | |
| subject_id | PositiveBigInt | booking.pk for bookings (generic FK, validated in `clean`) |
| member | FK User PROTECT null | payer |
| via_makerspace | FK SET_NULL null | routing for cross-tenant events (n/a to bookings) |
| subject_label | varchar(255) | snapshot (space name); never PII |
| amount | Decimal(12,2) **> 0** | major units |
| currency | char(3) lowercase `^[a-z]{3}$` | |
| status | varchar(16) enum `pending, paid_online, paid_offline, waived, canceled` default pending | |
| due_at | datetime null, **immutable** (save raises) | bookings: = starts_at |
| provider | varchar(16) `stripe \| razorpay \| unclaimed` default stripe | vendor provenance, immutable once claimed |
| external_order_id | varchar(255) null | Stripe session id / Razorpay payment-link id |
| external_payment_id | varchar(255) null | Razorpay payment id |
| checkout_url | URL blank | generic hosted link |
| stripe_provider | `raw \| connect` default raw | how Stripe creds resolved; immutable |
| stripe_connected_account_id | varchar null | immutable |
| stripe_application_fee_amount | PositiveBigInt (minor units) | immutable |
| online_rail | `checkout \| native_payment_intent` null | immutable once set |
| stripe_checkout_session_id | varchar unique null | legacy mirror |
| stripe_checkout_url | URL | legacy mirror |
| stripe_checkout_session_expired_at | datetime null | "page closed" stamp; also generation for idempotency key |
| stripe_payment_intent_id | varchar unique null | needed for Stripe refunds |
| created_by | FK User PROTECT | |
| created_at/updated_at | auto | |

Constraints: `payment_one_per_subject` UNIQUE(makerspace, subject_type, subject_id);
`payment_external_order_once_per_provider` UNIQUE(provider, external_order_id) WHERE not null;
`payment_external_payment_once_per_provider` UNIQUE(provider, external_payment_id) WHERE not null;
`payment_amount_positive`. Index `(makerspace, status, due_at)`, `(via_makerspace, member)`.
App-level `save()` guards: due_at immutable; terminal (non-pending) status/amount immutable; provenance fields immutable
except one-shot `unclaimed → vendor` claim; online_rail immutable once set. `full_clean()` on every save.
**Postgres trigger** `payments_payment_terminal_guard` (migrations 0002/0004/0013/0015):
- DELETE ⇒ raise unless GUC `app.allow_immutable_delete='on'`.
- UPDATE provider change when OLD.provider <> 'unclaimed' ⇒ raise.
- UPDATE when OLD.status <> 'pending' and (status or amount changes) ⇒ raise, **except** GUC
  `app.allow_waived_online_settlement='on'` AND waived→paid_online AND amount unchanged.

### 1.6 `ProcessedStripeEvent` (generic webhook idempotency) — same file
`makerspace` FK PROTECT, `provider` varchar(16) default stripe, `stripe_event_id` varchar(255), `created_at`.
UNIQUE `(makerspace, provider, stripe_event_id)`.

### 1.7 `Refund` — `backend/apps/payments/models_refund.py`
`payment` FK PROTECT (`refunds`), `amount` Decimal(12,2) >0, `currency`, `status` `pending|succeeded|failed` default pending,
`provider` `stripe|razorpay|manual`, `method` (ManualSettlement.Method or ""), `reference` varchar(64), `refunded_at` null,
`amends` O2O self null (`amended_by`), `external_refund_id` varchar null, `reason` varchar(255), `created_by` FK PROTECT,
`created_at`, `settled_at` null.
Constraints: `refund_manual_receipt_required` (manual ⇒ succeeded, refunded_at & settled_at set, no external id, valid method;
non-manual ⇒ method="", reference="", refunded_at null); `refund_amount_positive`;
`refund_external_once_per_provider` UNIQUE(provider, external_refund_id) WHERE not null.
`COUNTED_STATUSES = (pending, succeeded)`; `counted_total(payment)` sums counted, non-amended rows. Invariant: counted total
≤ payment.amount (service under Payment lock + `clean()` + trigger `payments_manual_refund_guard` in migration 0018).
Immutability: settled rows immutable; manual rows append-only (no update/delete; corrections = new row with `amends`).

### 1.8 `ManualSettlement` (cash book) — `backend/apps/payments/models_settlement.py`
`payment` FK CASCADE (`manual_settlements`), `method` enum `cash, upi, bank_transfer, card_machine, cheque, other`,
`reference` varchar(64) blank, `received_at` datetime (≤ now+5min at API), `amount` = payment.amount (enforced),
`currency` = payment.currency, `recorded_by` FK PROTECT, `amends` O2O self, `created_at`. Append-only (save on existing pk
raises; delete raises; trigger `payments_manual_settlement_guard`, migration 0016). `effective_for(payment)` = newest
non-amended row.

### 1.9 `PaymentDocument` (receipts / credit notes) — `backend/apps/payments/models_documents.py`
`makerspace`, `payment` (`documents`), `settlement` FK null, `refund` FK null, `reverses` O2O self null, `sequence` PositiveBigInt,
`number` varchar(80), `kind` `receipt|credit_note`, `issuer` JSON snapshot {name,address,tax_id,footer},
`payer_label` (username or "Account-less payer"), `payer_type` `member|account_less`, `lines` JSON
[{label, quantity, unit_amount, total}] (decimal strings; q×u=total; Σtotal=amount), `amount` >0, `currency`,
`settlement_method` (method or provider key), `settlement_reference`, `money_at`, `issued_at`, `issued_by` null,
`tax_breakdown` JSON (**must be NULL**).
Unique: `(makerspace, sequence)`, `(makerspace, number)`, `(makerspace, settlement)` WHERE set, `(makerspace, refund)` WHERE set,
`(makerspace, payment)` WHERE online receipt (no settlement/refund/reverses, kind=receipt). Checks: amount>0, sequence>0.
`clean`: ≤1 source; payment must be paid_online/offline; reversal must be opposite kind & same amount; credit note must match a
succeeded refund amount; receipt must equal full payment amount. Append-only.

### 1.10 `MakerspaceBillingSettings` — `backend/apps/payments/models_billing.py`
`payment_terms_days` 0..365 (0 ⇒ due now; booking passes explicit due_at so this is unused for bookings),
`reminder_days_before` list default [3], `reminder_days_after` list default [7] (≤20 distinct ints 1..365),
`max_reminders` default 2 (≤20), `number_prefix` varchar(32) (no control chars or slashes), `legal_name`, `address`, `tax_id`,
`footer`, `account_codes` JSON (keys income/cash/online/deposit/<subject types>), `next_document_number` BigInt ≥1 default 1.

### 1.11 `MakerspacePaymentSettings` — `backend/apps/payments/models_settings.py`
One-to-one makerspace. `provider` `stripe|razorpay` default stripe. Stripe raw: `stripe_publishable_key`, `stripe_secret_key`
(Fernet-encrypted text), `stripe_webhook_secret` (encrypted). Razorpay: `razorpay_key_id`, `razorpay_key_secret` (enc),
`razorpay_webhook_secret` (enc). `default_currency` char(3) default `usd`. Connect: `connect_account_id` unique `acct_…`,
`connect_status` `unconnected|pending|active|restricted|disconnected`, `connect_charges_enabled`, `connect_payouts_enabled`,
`connect_account_assigned_at`, `connect_status_updated_at`. (+ loan deposit fields, irrelevant.)
`raw_credentials_configured`: razorpay ⇒ key_id+secret+webhook_secret; stripe ⇒ secret+webhook_secret.
`PlatformStripeConnectSettings` singleton pk=1: platform keys, `stripe_connect_client_id`, `application_fee_bps` ≤10000.
`StripeConnectOAuthState`: state_digest unique, expires_at, consumed_at.

---

## 2. State machines

### 2.1 Booking status (`services_bookings.py`, `services_transitions.py`)
States: `pending, confirmed, rejected, cancelled, completed, no_show`.
| from | to | who / endpoint | extra guards |
|---|---|---|---|
| (new) | confirmed | create when space.approval_mode=instant | all rules + overlap vs confirmed |
| (new) | pending | create when approval_mode=approve | all rules; **no overlap check** |
| pending | confirmed | staff approve | space active; opening hours (incl. buffers) re-checked; ends_at > now; overlap vs other confirmed ⇒ 409. (Lead/advance/duration NOT re-checked) |
| pending | rejected | staff reject | — |
| pending, confirmed | cancelled | staff cancel, or member cancel (`member_cancel=True`) | member: must be owner, module enabled, `now < starts_at - cutoff_hours` |
| confirmed | completed | staff | `ends_at <= now` |
| confirmed | no_show | staff | `ends_at <= now` |
| pending/confirmed | (same, new times) | member reschedule | see §3.9 |
Terminal: rejected, cancelled, completed, no_show. Every transition: lock space then booking, `calendar_sequence += 1`,
`calendar_updated_at = now`, audit record (`booking.created|approved|rejected|cancelled|completed|no_show_marked|rescheduled`),
notification event of same name. Invalid transition ⇒ `BookingInvalidTransition` (HTTP 409). Overlap ⇒ `BookingConflict` (409).
Side effects: →confirmed (create or approve) ⇒ `create_for_confirmed_booking` (raise Payment). →cancelled ⇒ `cancel_for_booking`
(cancel the *pending* Payment only). Reject of a pending booking: no payment exists, nothing to do.
**No automatic transitions**: no pending expiry, no auto-complete, no auto-no-show, no check-in.

### 2.2 Payment status (`reconciliation.py`, `services_webhooks.py`, `terminal_settlement.py`)
```
pending ──webhook paid──────────────▶ paid_online
pending ──staff mark-offline+receipt▶ paid_offline   (ManualSettlement row + receipt doc in same txn)
pending ──staff waive───────────────▶ waived
pending ──subject cancelled─────────▶ canceled       (cancel_pending; booking cancel)
waived  ──late provider paid event──▶ paid_online    (only via GUC-gated trigger exception)
```
Everything else terminal & immutable (trigger). A provider "failed" event never changes status (audit + notify only).
Late paid event on `paid_offline` ⇒ audit `payment.paid_after_terminal` + `payment.double_paid_refund_required`; on
`canceled` ⇒ only `payment.paid_after_terminal` (see §11 bug). Payment `due_state` (derived, not stored):
`overdue | due_today | upcoming` by makerspace-local date of `due_at` vs today; only for pending (`payments/due_dates.py`).

### 2.3 Hosted-checkout sub-state on Payment (`checkout_expiry.py`)
live iff `status=pending AND stripe_checkout_session_expired_at IS NULL AND (checkout_url OR stripe_checkout_url)`.
`forget_closed_checkout` sets expired_at=now and clears session id/url/external_order_id/checkout_url (never intent id).
Idempotency key for creation: `payment-checkout-{pk}-{expired_at µs or 0}` — new generation after each expiry.

### 2.4 Refund status (`services_refunds.py`, `services_refund_webhooks.py`)
`pending → succeeded | failed` exactly once (`settle_refund` is idempotent; later calls only bind external id). Manual refunds
are born `succeeded`. Provider status normalisation: Stripe `succeeded→succeeded, pending/requires_action→pending,
failed/canceled→failed`; Razorpay `processed→succeeded, pending/created→pending, failed→failed`.

### 2.5 Connect account (`services_connect_webhooks.py`)
`account.updated` ⇒ refresh from Stripe (on failure mark restricted); `account.application.deauthorized` ⇒ `disconnected`,
charges/payouts false (ignored if event `created` predates `connect_account_assigned_at`). Disconnected is terminal locally
(later account.updated ignored).

---

## 3. Business rules

### 3.1 Validation order on create (`services_bookings.create_booking`)
1. `assert_mapped_write_allowed` (tenant encryption write fence), lock space (`select_for_update`), space must be active.
2. Certification gate if `space.machine_type` set (skip for port).
3. status = confirmed if instant else pending. If `member`: name = display_name|full_name|username, email, phone from user.
4. `_validate`: tz-aware datetimes, `full_clean`, ends>starts.
5. `enforce_booking_rules(space, start, end, now)` (`services_rules.py`):
   - `end-start >= min_duration`, `<= max_duration` (errors on `ends_at`)
   - `start >= now + lead_time_minutes` (error on `starts_at`)
   - `start <= now + max_booking_advance_days` (only START is bounded; end can exceed)
   - `enforce_opening_hours` (last, because it walks the calendar)
6. `ends_at > now`.
7. custom answers validated against `custom_form`.
8. `require_module_locked(makerspace,'bookings')`; `limits.check_quota(makerspace,'bookings',adding=1)` (plan quota).
9. If confirmed: `confirmed_overlap` ⇒ 409.
10. save, audit, notify `created`; if confirmed ⇒ raise Payment.

### 3.2 Opening hours & blackout (`makerspaces/local_time.py`, `profile_validation.py`, `bookings/services_schedule.py`)
`Makerspace.opening_hours` JSON:
- `{}` ⇒ always open (24/7).
- `{"weekly": {mon..sun: [{start:"HH:MM", end:"HH:MM"}]}, "exceptions": {"YYYY-MM-DD": [intervals]}}`.
  weekly must have all 7 days or be `{}` (=24/7 weekly); `[]` for a day = closed. ≤24 intervals/day, sorted, non-overlapping,
  start<end, `24:00` only as end; overnight must be split across days. ≤366 exception dates; an exception **replaces** that
  day's weekly intervals (`[]` = blackout/closure day; non-empty = special hours).
- Local wall times → UTC via makerspace tz; DST: ambiguous openings use first fold, closings last fold; nonexistent times shift
  forward; intervals merged after fold expansion.
- `next_open_interval(ms, after)`: first daily interval with end > instant (incl. ongoing); searches 15 days from `after`
  and from each future exception date.
- **Booking rule**: the *occupied window* `[start - buffer_before, end + buffer_after]` must be covered by **contiguous** open
  intervals (walks interval to interval; adjacent days' 23:00–24:00 + 00:00–… allow overnight). Gap ⇒ 400
  `starts_at: "Booking and cleanup buffers must fit within opening hours."`
- `published_open_intervals(ms, a, b)` merges adjacent intervals for the public availability response.
There is **no per-space schedule or per-space blackout**; closures are makerspace-wide date exceptions.

### 3.3 Buffers & overlap (`services_schedule.py`)
- `occupied_window(space, s, e) = (s - before, e + after)`.
- `confirmed_overlap(space, s, e, exclude=None)`: exists CONFIRMED booking on space with
  `starts_at < e + gap AND ends_at > s - gap`, `gap = before + after` (both bookings share the same space buffers, so comparing
  occupied windows reduces to this). Half-open: back-to-back is allowed when gap=0.
- `validate_buffer_change`: when buffers change, walk all CONFIRMED bookings with `ends_at > now - buffer_after` in start order;
  if any occupied window overlaps the previous ⇒ 400 (always keyed `buffer_after_minutes`).

### 3.4 Approval vs instant
Per-space `approval_mode`. Instant ⇒ confirmed immediately (+charge). Approve ⇒ pending; pending rows don't reserve the slot;
multiple pendings may overlap each other and a confirmed booking can be created over a pending one; on approve the overlap is
re-checked and approval fails with 409 if taken. `approval_mode` is only editable via the booking-rules endpoint (requires
MANAGE_MAKERSPACE), not via space create/update (MANAGE_BOOKINGS), so API-created spaces get the service default `instant`.

### 3.5 Pricing / tax
Flat `space.payment_amount` per confirmed booking (`service_payments._get_or_create`), currency =
`MakerspacePaymentSettings.default_currency`, `subject_label = space.name`, `due_at = booking.starts_at`. Charged only if
`member` is set AND `payment_amount > 0` AND `charge_tracking_enabled(ms,'bookings')` = features `charges.enabled` AND
`charges.bookings`. Online link only if `online_payments_enabled(ms,'bookings')` = module `payments` AND feature
`payments.enabled` AND `payments.bookings` AND credentials resolve. Otherwise the debt is recorded with `provider=unclaimed`
and settled at the desk. No price snapshot on the booking (the Payment row *is* the snapshot). Recurring: each occurrence its
own flat charge. Reschedule: charge unchanged (amount and due_at stay). Tax: none.

### 3.6 Holds / locks / concurrency
- Lock order bookings: `BookableSpace` row FOR UPDATE → `Booking` row FOR UPDATE (`_locked_booking`). All of create, approve,
  reject, cancel/complete/no-show, reschedule, rules update, image set take the space lock.
- Payments lock order: `PlatformStripeConnectSettings` (pk=1, speculative when unclaimed/connect) → `MakerspacePaymentSettings`
  → `Payment` (`checkout_coordination.py` docstring). Reconciliation takes Payment only. Documents: Payment → Makerspace →
  BillingSettings counter.
- Payment creation race: unique `(makerspace, subject_type, subject_id)`; `_get_or_create` does filter-first, then create in a
  savepoint, catching IntegrityError ⇒ re-get.
- Provider network calls are kept outside row locks for refunds (`services_refunds` 3-step) but checkout creation calls the
  provider while holding Payment/settings locks (with idempotency key).

### 3.7 Recurring bookings (`services_recurrence.py`, `views_recurrence.py`) — staff only
Feature `bookings.recurring` must be enabled; actor needs MANAGE_BOOKINGS. Input = staff booking input + `count` 2..52 +
`interval_weeks` 1..12, with `(count-1)*interval_weeks <= 52`. Occurrence i = same **local wall-clock** time on
`local_date + i*interval_weeks`, duration preserved (so DST-stable local time). Nonexistent local time (spring-forward gap)
⇒ that occurrence reported `conflict`. Each occurrence calls the normal `create_booking` inside the outer atomic; failures
(`BookingConflict`, `BookingInvalidTransition`, `ValidationError`) are caught and reported per occurrence
(`{occurrence, starts_at, ends_at, booking_id|null, status|'conflict', detail}`); never silently skipped. Audit
`booking.recurrence_created` with requested/created counts. **No series entity** — bookings are not linked; no series cancel.
(Caveat: catching exceptions inside one atomic relies on Django's per-call atomic savepoint in `create_booking`.)

### 3.8 Cancellation & refund policy
- `cancellation_cutoff(b) = starts_at - cancellation_cutoff_hours`; `member_can_cancel = status in (pending, confirmed) and now < cutoff`.
  Staff can cancel any pending/confirmed booking anytime (no cutoff).
- On cancel: `cancel_pending` sets the booking's Payment to `canceled` **only if still pending** and best-effort expires the
  hosted link/intent. If already paid (online/offline) nothing happens — **no automatic refund, no refund %/fee policy**. Staff
  must refund manually via payments panel (§5.7). No cancellation fee concept.

### 3.9 Reschedule (`services_reschedule.py`, member only)
Locks space+booking; module enabled; active account; not a revoked member; actor must be owner; `member_can_cancel` (cutoff not
passed, status pending/confirmed); space active; certification; validate new times; `enforce_booking_rules` (all rules incl.
opening hours); new `starts_at > now + cancellation_cutoff_hours`; overlap vs other confirmed (excluding self) ⇒ 409. Status is
kept (pending stays pending — **overlap is checked even for pending here**, unlike create). sequence++, audit
`booking.rescheduled` with old/new times, notify `confirmed` or `created`. Payment untouched (amount and due_at = old start).

### 3.10 No-show / completion / check-in
Manual staff actions only, only from confirmed, only after `ends_at`. No check-in model or kiosk flow for spaces. No penalties.

### 3.11 Identity/eligibility for self-booking (`bookings/access.py`)
`require_active_account(user, ms)`; if the user has any membership row in that makerspace it must be active and waiver-current
(`require_active_member`). Membership is optional (account-only users may book). Staff booking on behalf requires target to be
an active member with active account (`views_admin_booking_create._members`).

### 3.12 Public visibility
Public list = `is_public AND is_active`. Availability endpoint returns opening intervals always; returns busy windows
(occupied windows incl. buffers, confirmed only) only when `show_public_availability`; booker names only when
`show_public_booker_names`. Query window must be tz-aware, end > start, end > now, ≤31 days.

---

## 4. API surface (bookings)

Public/member, mounted under `/api/v1/public/` (`bookings/urls_public.py`):
| method path | auth | purpose |
|---|---|---|
| GET `<slug>/spaces/` | none, throttle `public_read` 120/min | public spaces (fields: public_token, name, kind, description, capacity, location, image_url, approval_mode, custom_form, show_public_*) — note **payment_amount is not exposed publicly** |
| GET `<slug>/spaces/<token>/availability/?starts_at&ends_at` | none | {public_token, starts_at, ends_at, timezone, opening_intervals[], availability[]\|null (starts_at, ends_at, booker_name)} |
| POST `<slug>/spaces/<token>/book/` | authenticated, throttle `booking_submit` 10/hour | body {starts_at, ends_at, custom_answers?, certification_override_reason?, website(honeypot)} → 201 {status: pending\|confirmed}. Honeypot `website` non-empty ⇒ fake 201 with expected status, nothing saved |
| GET `<slug>/my-bookings/?period=upcoming\|past&page` | auth, page 24 | own bookings: public_token, space_name, timezone, starts_at, ends_at, status, cancellation_cutoff_at, can_cancel. upcoming = ends_at>now asc; past = ends_at<=now desc |
| POST `<slug>/my-bookings/<token>/cancel/` | auth, body `{}` exactly | member cancel |
| POST `<slug>/my-bookings/<token>/reschedule/` | auth | {starts_at, ends_at} |
| GET/POST/DELETE `<slug>/my-bookings/calendar/` | auth | feed state {enabled, token_hint} / issue-or-rotate → {feed_url, token_hint} (no-store) / revoke 204 |
| GET `<slug>/bookings/calendar/<raw_token>.ics` | none (token), throttled per token & IP | ICS of own bookings |

Staff, mounted under `/api/v1/admin/` (`bookings/urls_admin.py`, all `IsActiveStaff`):
| path | perm | purpose |
|---|---|---|
| GET/POST `makerspaces/<id>/spaces/` | MANAGE_BOOKINGS | list (q, ordering name/kind/created_at, paged) / create |
| GET/PATCH `spaces/<pk>/` | MANAGE_BOOKINGS | detail/update (fields in `services_spaces.SPACE_FIELDS`) |
| POST `spaces/<pk>/deactivate/` | MANAGE_BOOKINGS | soft delete |
| POST `spaces/<pk>/image/presign/` → POST `.../image/finalize/` → DELETE `.../image/` | MANAGE_BOOKINGS | S3 presigned upload (`spaces/<ms>/<space>/images/<uuid><ext>`, size-limited `PUBLIC_IMAGE_MAX_BYTES`, MIME sniffed), storage quota via `limits.add_storage`, old image released on commit |
| GET/PATCH `spaces/<pk>/booking-rules/` | **MANAGE_MAKERSPACE** | the 8 rule fields incl. approval_mode |
| GET `spaces/<pk>/bookings/?status&starts_at&ends_at&booking_id&ordering&page_size≤500` | MANAGE_BOOKINGS | list w/ embedded `payment {id,status,amount,currency}` |
| POST `spaces/<pk>/bookings/` | MANAGE_BOOKINGS | staff booking on behalf: {member_id, starts_at, ends_at, note?, custom_answers?, certification_override_reason?}; unknown keys rejected |
| GET `spaces/<pk>/eligible-members/` | MANAGE_BOOKINGS | active members for picker |
| POST `spaces/<pk>/recurring-bookings/` | MANAGE_BOOKINGS + feature | weekly series |
| POST `bookings/<pk>/approve|reject|cancel|complete|no-show/` | MANAGE_BOOKINGS | body must be `{}` |
Error contract: 400 field-error map; 409 conflict/invalid transition; 423 tenant frozen; 503 tenant write gate.

---

## 5. Payments

### 5.1 Provider abstraction (`payments/providers/base.py`, `__init__.py`)
Protocol `PaymentProvider { key; create_checkout(source, CheckoutRequest)->CheckoutResult; expire_checkout(source, order_id);
create_refund(source, RefundRequest)->RefundResult; verify_webhook(source, payload: bytes, headers)->WebhookEvent }`.
Rules: never block domain action (raise only `PaymentsUnavailable`); verify signature over RAW body; amounts are integer
minor units. `WebhookVerificationError` distinct. Registry is a static dict `{stripe, razorpay}`; unknown key raises (never
default). DTOs:
- `CheckoutRequest{amount_minor, currency, description, reference, success_url, cancel_url, metadata, idempotency_key, application_fee_minor=0}`
- `CheckoutResult{order_id, checkout_url, payment_id=""}`
- `RefundRequest{payment_id, amount_minor, currency, reference, idempotency_key, metadata}` / `RefundResult{refund_id, status}`
- `WebhookEvent{event_id, is_paid, order_id, payment_id, metadata, refund_id, refund_status, refund_amount_minor, is_failed}`
Credential resolution (`payments/resolution.py`): `PaymentSource{provider raw|connect, secret_key, webhook_secret,
publishable_key, connected_account_id, application_fee_bps, vendor}`. `resolve_payment_source(ms)` uses current settings
(razorpay ⇒ own keys only; stripe raw keys; else if not self-host and Connect active+charges_enabled ⇒ platform keys +
account). `source_for_payment(p)` resolves by the row's stamped provenance (so old charges settle after a vendor switch).
Money: `payments/money.py` `to_minor_units` uses ISO-4217 exponents (0-decimal JPY/KRW/…, 3-decimal BHD/JOD/KWD/OMR/TND),
ROUND_HALF_UP. Application fee = round_half_up(minor × bps / 10000).

### 5.2 Order / checkout creation (`checkout_coordination.py`, `checkout_provider.py`)
`create_checkout(payment)` schedules `create_checkout_url` on commit (errors logged, swallowed). `create_checkout_url`:
lock (platform)→merchant→payment; return "" if not pending; 409-ish `PaymentRailConflict` if native rail; return existing live
url if any; set `online_rail=checkout` if null; claim provider if `unclaimed` (stamps provider/stripe_provider/account/fee once);
resolve source; Connect: verify merchant account matches and refresh status (not active/charges ⇒ restrict + unavailable);
return URL = `member_payment_return_url(via_makerspace or makerspace)` + `?checkout=success|cancelled`; label from subject.
- Stripe: `checkout.Session.create(mode=payment, client_reference_id=pk, metadata{payment_id, makerspace_id}, one line item
  price_data{currency, unit_amount=minor, product name=label}, payment_intent_data.application_fee_amount?)` with idempotency
  key; store session id in both `stripe_checkout_session_id` and `external_order_id`, url in both url columns, clear expired_at.
- Razorpay (`providers/razorpay.py`): stdlib urllib Basic auth `key_id:key_secret`, `POST /v1/payment_links` {amount minor,
  currency UPPER, description≤2048, reference_id=payment pk, callback_url=success_url, callback_method=get, notes=metadata,
  notify{sms:false,email:false}, reminder_enable:false}; store `id`→external_order_id, `short_url`→checkout_url. Timeout 15 s;
  HTTP errors logged by status only (body may echo PII).
Member endpoint `POST /api/v1/member/makerspaces/<id>/payments/<pid>/checkout` (`payments_rail/views_member_checkout.py`):
own pending payment only (`member_scope.member_payment_queryset`); return live URL; if online not enabled for subject ⇒ 503
`payments_unavailable`; rail conflict ⇒ 409; provider failure ⇒ 503.
Native mobile rail (`services_mobile.py`, `.../mobile-intent`): Stripe-only PaymentIntent (automatic_payment_methods,
metadata, application_fee), idempotency `payment-mobile-intent-{pk}`, returns {payment_id, client_secret, publishable_key};
rails are mutually exclusive per payment.

### 5.3 Signature verification
- Stripe: `stripe.Webhook.construct_event(raw_body, Stripe-Signature, webhook_secret)` (`stripe_client.construct_event`).
- Razorpay: `hex(HMAC_SHA256(webhook_secret, raw_body))` vs `X-Razorpay-Signature` with `hmac.compare_digest` on bytes.
  Event id = `X-Razorpay-Event-Id` header, fallback `"{event}:{refund|link|payment|order id}"`.
Routes (`config/urls.py`): `POST /api/v1/webhooks/stripe/<public_code>` (raw keys), `POST /api/v1/webhooks/stripe/connect`
(platform), `POST /api/v1/webhooks/razorpay/<public_code>`. Tenant addressed by public code (archived allowed); 404 unknown;
400 unconfigured/wrong provider/bad signature; 200 for every verified event, even ignored ones. Webhooks are NOT gated by the
payments module/feature toggles (money already taken must settle).

### 5.4 Webhook handling (`services_webhooks.py`, `services_refund_webhooks.py`, `services_connect_webhooks.py`)
Stripe handled types: `checkout.session.completed` (only if `payment_status` in {paid, None}),
`checkout.session.async_payment_succeeded`, `checkout.session.expired`, `payment_intent.succeeded`,
`payment_intent.payment_failed`, `checkout.session.async_payment_failed`, plus refund types `charge.refunded,
charge.refund.updated, refund.created, refund.updated, refund.failed`. Others ignored (not recorded).
Algorithm (one DB transaction):
1. Find payment by `stripe_checkout_session_id` OR `stripe_payment_intent_id`, filtered by makerspace, provider=stripe,
   stripe_provider (raw/connect) and connected account; `SELECT FOR UPDATE`. Not found ⇒ return (event not recorded).
2. `_record_once(makerspace, event_id, provider)` INSERT into ProcessedStripeEvent; IntegrityError ⇒ duplicate ⇒ return.
   (Recorded in the same txn as the effect ⇒ a crash rolls both back ⇒ retry is safe.)
3. failed ⇒ `record_payment_failure` (audit `payment.failed`, notify payer `payment_failed`, only if still pending).
4. expired ⇒ `forget_closed_checkout`, audit `payment.checkout_expired` (applies regardless of status).
5. status != pending ⇒ `handle_*_paid_after_terminal` (waived→promote to paid_online via GUC; paid_offline→flag double-paid).
6. else status=paid_online, store intent id, audit `payment.paid_online`, `issue_receipt`, notify `payment_received`.
Razorpay: paid events `payment_link.paid, order.paid, payment.captured` (NOT `payment.authorized`); `payment.failed` ⇒ failure;
refund entity present ⇒ refund path. Non-payment events are not recorded (so a later real event with same delivery id isn't
swallowed). Lookup by `external_order_id` or `external_payment_id`, provider=razorpay; stores `external_payment_id` on first paid.
Connect: account events ⇒ §2.5; charge events ⇒ find payment by connected account + session/intent, then delegate to
`apply_webhook_event(provider=connect)`.
**Ordering**: there is no event-timestamp ordering; correctness relies on state checks (pending-only settlement, failure ignored
after settle, expiry only clears link fields, refund settle-once, deauth staleness check vs `connect_account_assigned_at`).

### 5.5 Reconciliation (staff, ledger) — `payments/reconciliation*.py`, `views_reconciliation.py`, `payments/urls.py`
Routes under `/api/v1/` (`payments/urls.py`, mounted in `config/urls.py`):
- `GET admin/makerspace/<id>/payments?status&subject_type&due_state&for_recording&ordering&page` — VIEW_FINANCE, or
  RECORD_PAYMENT with `for_recording=true` (then only pending + paid_offline). Annotates `refunded_amount` (succeeded,
  non-amended), ordered by due_at nulls last.
- `POST .../payments/<pid>/mark-offline` {method, reference?, received_at} and `POST .../payments/bulk/mark-offline`
  {ids[], settlement{...}} — RECORD_PAYMENT or subject authority (booking ⇒ MANAGE_BOOKINGS).
- `POST .../payments/<pid>/waive`, `.../bulk/waive` {ids[] unique} — subject authority only.
- `POST .../payments/<pid>/amend-settlement` — append a ManualSettlement with `amends`, reissue receipt (credit note reversing
  old receipt + new receipt).
`reconcile_payments`: lock all ids ordered by pk; any missing ⇒ 404; any non-pending ⇒ 409 `payment_terminal` with ids
(all-or-nothing); for each: best-effort expire live link/intent, set status, for offline create ManualSettlement (amount/currency
from payment, never caller) + receipt doc, audit `payment.paid_offline|payment.waived`, notify `payment_received` (offline).
Expire best-effort (`reconciliation_rail.py`): native intent ⇒ cancel PaymentIntent; else non-Stripe ⇒ provider.expire_checkout
(Razorpay `POST /payment_links/{id}/cancel`); Stripe ⇒ `checkout.Session.expire`. Failures logged, never block.
**There is no scheduled reconciliation job against providers** (no polling of Stripe/Razorpay). "Reconciliation" = staff
cash-book actions + webhooks + credential-rotation check (`credential_validation.py`: changing raw Stripe keys is refused while
possibly-live sessions exist; locked path asks Stripe whether each session is closed and persists closures).

### 5.6 Terminal settlement (`payments/terminal_settlement.py`)
Paid event arriving after staff made the charge terminal:
- `waived` ⇒ `promote_waived_to_paid_online`: `SET LOCAL app.allow_waived_online_settlement='on'`, conditional UPDATE where
  status=waived, store intent id, issue receipt, notify. Ledger corrected to reflect real money.
- `paid_offline` ⇒ audit `payment.paid_after_terminal` + `payment.double_paid_refund_required` (staff must refund one).
- `canceled` / `paid_online` ⇒ audit `payment.paid_after_terminal` only.

### 5.7 Refunds
Online (`services_refunds.refund_payment`; route `POST admin/makerspace/<id>/payments/<pid>/refund` {amount, reason?} in
`payments_rail/urls.py`; subject authority):
1. Under Payment lock: amount quantized 0.01 >0; payment must be `paid_online`; `counted_total + amount <= payment.amount`;
   create Refund(pending, provider=payment.provider).
2. Outside locks: provider.create_refund (Stripe `Refund.create(payment_intent, amount, metadata)` idem `payment-refund-{refund.pk}`;
   Razorpay `POST /payments/{id}/refund {amount, receipt=ref[:40], notes}`).
3. `settle_refund` with sync status; failure ⇒ FAILED + 502 `RefundProviderFailure`. Pending ⇒ audit `payment.refund_requested`,
   webhook finishes. Succeeded ⇒ audit `payment.refunded`, credit note, notify `refund_issued`.
Webhook matching (`_match_refund`): by bound `external_refund_id`, else oldest unbound PENDING refund with same minor amount
(binds it). Refunds made in the vendor dashboard (no local row) are logged `payment_refund_unmatched`, not invented.
Partial refunds = multiple rows. Payment row status never changes on refund (no `refunded` payment status).
Offline/manual (`services_refunds_offline.py`; `POST .../refund-offline` {amount, reason, receipt{method, reference?,
refunded_at ≤ now+5min}}; RECORD_PAYMENT): payment must be `paid_offline`; balance check; Refund(provider=manual,
status=succeeded, settled_at=now) + credit note + notify. Amend manual refund receipt = append replacement row with `amends`
(same amount), reissue credit note (reversal receipt + new credit note).

### 5.8 Receipts / invoices numbering (`payments/documents.py`)
`issue_receipt(payment, actor?, settlement?)` on paid_online (webhook), paid_offline (reconcile), waived→online promotion,
settlement amendment; `issue_credit_note(refund)` on succeeded refunds. Idempotent per source (online receipt once per payment;
one doc per settlement / refund / reversal). Issued only if feature `billing.documents` enabled (or payment already has docs).
Numbering: lock Payment → lock Makerspace row → get_or_create + lock `MakerspaceBillingSettings`; `sequence =
next_document_number`; `number = f"{number_prefix}{sequence:06d}"`; counter++ — gapless per makerspace, shared by receipts
and credit notes. Issuer snapshot from billing settings (legal_name or makerspace name). Single line item
(subject_label × 1). After commit: email payer a link to the member area (no attachment, no direct link;
`document_delivery.py`). PDF rendered on demand with ReportLab (`document_pdf.py`, deterministic `invariant=1`). Download:
`GET .../payment-documents/<id>/download-url` returns a signed token (`django.core.signing`, salt
`payments.document.download.v1`, TTL 300 s, bound to user+space+audience) → `GET payment-documents/<id>/download?token=`.
These are receipts, not tax invoices (no GST fields beyond `tax_id` text).

### 5.9 Offline payments (summary)
A charge with no online rail is still recorded (`provider=unclaimed`). Staff settle it with a mandatory receipt
(method + received_at; reference optional) → `paid_offline` + `ManualSettlement` + receipt doc. If an online gateway is
configured later, the first checkout claims the row (trigger permits unclaimed→vendor once).

### 5.10 Member payment surfaces (`payments/urls_member.py`, `views_member.py`, `member_scope.py`)
`GET /api/v1/member/makerspaces/<id>/payments` (history incl. `checkout_url` = live link, `online_payment_available`,
settlement, refunds, due_state/due_date); `.../payment-documents` and `.../download-url`; `GET member/archived-payments`.
Visibility: `member=user` AND (makerspace_id=this OR event charge routed via this space); revoked members restricted.

---

## 6. Scheduled tasks (celery beat, `backend/config/settings.py` ~L590-730)
Only one beat entry touches bookings/payments: **`reminder-sweep`** → `apps.operations.tasks_reminders.run_reminder_sweep_task`
every 5 min, which drives registered `ReminderSource`s (`operations/reminder_registry.py`) with durable at-most-once claims in
`operations.ReminderSchedule` (unique `(makerspace, source, subject, kind, offset_seconds)`, states pending/claimed/completed/failed):
- `bookings.booking` (`bookings/reminders.py`): CONFIRMED bookings with a member, `starts_at` in (now, now+max lead], offsets =
  `-lead_hours*3600` from `Makerspace.booking_reminder_lead_hours` (default [24]); requires `membership` module; revalidates at
  dispatch (still confirmed, same starts_at — so a reschedule invalidates old reminders, still future, requester toggle on,
  recipient member still eligible). Subject id is `occurrence_subject(pk, starts_at)`.
- `payments.due` (`payments/reminders.py`): pending payments with due_at & active member; steps = sorted
  {-before..., 0, +after...}[:max_reminders] local days; requires `email` module, payments email notification enabled, feature
  `billing.reminders`; events `payment_due_soon | payment_due_today | payment_overdue`; after downtime only the latest elapsed
  step is sent; advance/due-day notices expire with their day.
**Absent**: pending-booking expiry, auto-complete/no-show, checkout-session expiry sweep (relies on Stripe `expired` webhook),
provider reconciliation polling, payment auto-cancel when booking passes.

---

## 7. Notifications / email / ICS
- `bookings/notifications.py` `notify_booking_status(booking, event)` for events `created, confirmed, rejected, cancelled,
  completed, no_show` (+ `reminder`). Built lazily via `integrations.notify.notify_lifecycle(feature="bookings")`:
  requester email (template `bookings/requester/<event>`) only if effective toggle (space override else makerspace default False)
  and email present; staff emails to `staff_emails_for_feature(ms,'bookings',event)` (template `bookings/staff/<event>`);
  chat channels get the STAFF text; in-app inbox item for the member ("Booking <event>", link `/m/<slug>/member`). Context
  (`integrations/email_templates_fablab.bookings_context`): booking{id,status,name,when,space{name}}, next_steps from
  `BOOKINGS_REQUESTER_BODIES`. Tenant-customisable templates (`email_templates.render`).
- `payments/notifications.py` `notify_payment(payment, event)` events `charge_raised, payment_received, payment_failed,
  refund_issued, payment_due_soon, payment_due_today, payment_overdue, document_issued`. Staff payload carries only id/status
  (no amounts in chat); requester gets amount/currency/due_date.
- **ICS**: no ICS attachment in emails. Only the private subscription feed (`views_feed.py`): `icalendar` lib, PRODID
  `-//SpaceWorks//Bookings//EN`, per booking UID `booking-<public_token>@spaceworks`, DTSTAMP/LAST-MODIFIED =
  calendar_updated_at, SEQUENCE = calendar_sequence, SUMMARY = space name, STATUS CANCELLED (cancelled/rejected) | TENTATIVE
  (pending) | CONFIRMED (else; completed/no_show too). Max 1000 events: upcoming first (by start), then most recent history.
  Token 32-byte urlsafe (43 chars, regex-checked), stored as sha256 digest, constant-time compare; headers
  `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`; rotate = new token same row; revoke sets revoked_at.
  Feed request revalidates account active & not revoked member.

---

## 8. Permissions / roles (`accounts/rbac_actions.py`, `rbac_bookings.py`)
Actions: `MANAGE_BOOKINGS` (spaces CRUD, booking list/actions/staff create/recurring, waive/offline for booking charges),
`MANAGE_MAKERSPACE` (booking rules incl. approval mode; superadmin-ish), `VIEW_FINANCE` (payment list), `RECORD_PAYMENT`
(cash receipts across domains, manual refunds; counter role), subject authority for waive/online refund
(booking ⇒ MANAGE_BOOKINGS). Built-in roles: `space_manager` has all of these; inventory/machine/print managers have none of
them. Staff endpoints also require `IsActiveStaff` and module `bookings` enabled (`require_module`). Members: authenticated,
active account, own rows only (`scope_personal_bookings`). Public: anonymous read of public spaces/availability.
Module/feature gates: module `bookings`, `payments`, `membership` (reminders), `email`; features `bookings.recurring`,
`charges.enabled`, `charges.bookings`, `payments.enabled`, `payments.bookings`, `billing.documents`, `billing.reminders`.
Plan quota `limits.check_quota(ms,'bookings')`. Throttles: `public_read` 120/min, `booking_submit` 10/hour (submit, cancel,
reschedule), feed per-token/per-IP.

---

## 9. Frontend (React/Vite, `frontend/src`)
Routes (`AppRoutes.tsx`): `/m/:slug/bookings` (and `/bookings` in single-tenant mode) → `PublicBookingsPage`;
`/m/:slug/member[/:memberTab]` → `MemberArea` (bookings + payments tabs); `/m/:slug/admin/*` → `StaffApp`.
- `features/bookings/PublicBookingsPage.tsx` — tenant-branded list of public spaces (cards w/ kind label, image, capacity,
  location, approval badge) + per-space month discovery calendar + booking form.
- `features/bookings/SpaceDiscoveryCalendar.tsx` — month grid of confirmed busy windows (splits >31-day DST months into two
  availability calls); "availability not published" fallback; disclaimers that empty ≠ bookable.
- `features/bookings/AvailabilityCalendar.tsx` — 14-day paged list of opening intervals + busy windows (tz-labelled).
- `features/bookings/PublicBookingForm.tsx` — datetime-local start/end, custom-form answers, hidden honeypot `website`;
  maps 401 "sign in", 403 account/waiver, 409 "slot now overlaps", 429; success panel "request received" vs "space booked".
  No price shown, no checkout step.
- `features/bookings/MyBookings.tsx` — member upcoming/past tabs, cutoff text, Reschedule (`BookingReschedule.tsx`) and Cancel
  with confirm; `BookingCalendar.tsx` — enable/rotate/revoke ICS feed and show URL.
- `features/members/MemberPayments.tsx` — member charges list: subject, status, due badge, amount, refunded amount, "Pay"
  link (live `checkout_url`) or POST checkout; returns with `?checkout=success|cancelled`. `ArchivedPayments.tsx`,
  `features/payments/PaymentDocuments.tsx` (receipts/credit notes download via short-lived grant).
- Staff: `staff/BookingsPanel.tsx` (spaces table, create modal via `BookableSpaceForm.tsx`), `staff/BookingDrawer.tsx`
  (space details/edit/deactivate/image, `StaffBookingForm.tsx` incl. recurring, bookings table w/ status filter + date range,
  actions: pending ⇒ Approve/Reject, confirmed ⇒ Cancel, confirmed & ended ⇒ Complete/No-show, payment summary badge),
  `MakerspaceBookingRulesSettings.tsx` (per-space 7 numeric rules + approval mode), `MakerspaceBookingSettings.tsx`,
  `MakerspaceHoursEditor.tsx` (weekly hours + date exceptions), `MakerspaceReminderSettings.tsx`, `BookableSpaceMachineType.tsx`.
- Staff payments: `staff/PaymentsPanel.tsx` (filters status/subject/due_state/for_recording, bulk mark-offline/waive,
  settlement dialog, amend receipt, refund), `PaymentReconcileActions.tsx`, `PaymentRefundDialog.tsx` (online vs offline
  refund, deposit release), `RefundReceiptAmendDialog.tsx`, `PaymentDueBadge.tsx`, `paymentAccess.ts` (client-side action
  gating), `MakerspacePaymentSettings.tsx` (provider select, keys, currency, Connect onboarding),
  `BillingDocumentsSettings.tsx` (prefix, legal name, address, tax id, footer, terms, reminder ladder),
  `panels/OperationsReportsBookings.tsx` / `OperationsReportsPayments.tsx` (reports).

---

## 10. Audit actions emitted (for parity)
Bookings: `booking.space_created|space_updated|space_deactivated|space_rules_updated|space_image_updated|space_image_removed`,
`booking.created|approved|rejected|cancelled|completed|no_show_marked|rescheduled|recurrence_created`,
`booking.feed_created|feed_rotated|feed_revoked`.
Payments: `payment.created, checkout_created(services_checkout_audit), checkout_expired, paid_online, paid_offline, waived,
canceled, failed, paid_after_terminal, double_paid_refund_required, settlement_amended, refund_requested, refunded,
refund_failed, refund_recorded, refund_amended, document_issued, mobile_intent_created`, `payments.connect_*`.

---

## 11. Edge cases handled, and bugs/TODOs worth NOT repeating

Handled well (keep):
- Tz-aware datetimes mandatory everywhere; DST-correct local-day math; recurrence keeps local wall time.
- Overlap on half-open intervals with buffers; buffer edits validated against existing bookings.
- Opening-hours check covers buffers and allows overnight across contiguous days.
- Rule bounds prevent datetime overflow.
- Webhook idempotency row in same transaction as effect; provider-scoped event ids; signature over raw bytes; constant-time compare.
- Integer minor units with correct ISO exponents (JPY/KWD bugs fixed historically).
- Payment provenance immutable; per-provider unique external ids; checkout idempotency key regenerates after expiry; generic +
  legacy URL columns both cleared on expiry (prior bug: dead link handed back forever).
- Late payment after waive is promoted; after offline is flagged.
- Refund balance counts pending refunds (prevents concurrent over-refund); provider call outside locks.
- Receipts/credit notes gapless, append-only, reversal documents for corrections.
- ICS feed tokens hashed, revocable, no PII in feed.

Gaps / bugs / smells to avoid in the port:
1. **No DB-level double-booking guarantee** — relies on the space row lock. In Postgres use an exclusion constraint
   (`EXCLUDE USING gist (space_id WITH =, tstzrange(start-before, end+after) WITH &&) WHERE status='confirmed'`) or keep the lock.
2. **PENDING requests don't hold the slot**; approvals can 409 late; no pending expiry; overlapping pendings pile up.
   Inconsistency: reschedule checks overlap even for pending, create doesn't.
3. **Approve skips lead-time / advance / duration rules** (only hours, end>now, overlap) — a stale request can be approved
   after its lead window passed (only blocked once it has ended).
4. **Cancellation of a paid booking does nothing to the money**: `cancel_pending` only touches pending charges; no refund policy,
   no flag for staff. Paid-after-cancel webhook only writes `payment.paid_after_terminal` (no `refund_required` flag, unlike
   paid_offline) — money can be silently retained.
5. **Reschedule leaves `Payment.due_at` at the old start** (due_at immutable) and never re-prices; payment reminders then fire
   against the stale date.
6. `create_for_confirmed_booking` / `cancel_for_booking` swallow *all* exceptions inside the booking's atomic block; a DB
   error there (outside the inner savepoint) would poison the Postgres transaction. Use outbox/after-commit jobs instead.
7. Checkout creation is `transaction.on_commit` fire-and-forget with no retry job; if Stripe is down the member must click
   "Pay" to regenerate. No sweeper for stuck pending charges.
8. Stripe `checkout.session.completed` with `payment_status` **None** is treated as paid (`not in {"paid", None}`) — only
   accept explicit `paid`.
9. Model default `approval_mode=approve` vs service/API default `instant`, and approval mode is editable only by
   MANAGE_MAKERSPACE — confusing split of permissions between space editor and rules editor.
10. `validate_buffer_change` always reports the error on `buffer_after_minutes` even when `buffer_before_minutes` changed.
11. `max_booking_advance_days` bounds only the start; a long booking may end beyond the window.
12. Recurring series have no parent entity (can't cancel/edit the series); partial creation is reported but committed.
13. `capacity` unused; no seat/shared-space bookings.
14. Opening hours are global to the makerspace — no per-space hours or per-space blackouts; no holiday calendars beyond ≤366
    exception dates.
15. No check-in, no auto-complete/no-show; completion requires manual staff action after end.
16. Public space list hides `payment_amount`, so users don't see the price before booking; the charge just appears in the
    member area afterwards.
17. Razorpay webhook event-id fallback (`event:entity_id`) can collide across distinct events on the same entity if the
    header is stripped; Razorpay ignores non-payment events entirely.
18. Webhook lookups for unknown payments return before recording the event id (fine), but there is no dead-letter/log table
    for unmatched events beyond logger warnings.
19. Payment docs say Razorpay is own-account only; no marketplace/route split for platform fees.
20. Tax/GST explicitly unimplemented (`tax_breakdown` must be NULL); invoice numbering is per makerspace with a single prefix
    (no financial-year reset, no separate series for credit notes) — an Indian GST port needs FY-based series and tax lines.
21. Email for receipts contains no attachment/link to the PDF itself (by design: short-lived grants) — fine, but note it.
22. Booking PII stored encrypted (TextField + mapper) — searching by name/email in staff lists is not supported for that reason.
