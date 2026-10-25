# Payments

How money is taken, recorded and receipted. Tax rules are in [GST.md](GST.md).

The payment infrastructure (gateways, receipts, credit notes, webhooks, reconcile) comes from the platform this
product was forked from. Bookings pay through it: charge modes, deposits, pay later, tiered refund policies and
every refund scenario are in "Booking money" below (`lib/bookings/money/*`).

## Ways to pay

Each makerspace picks **one** gateway, or none:

| Gateway | How the customer pays | Notes |
| --- | --- | --- |
| Razorpay | Checkout.js on our page (UPI, cards, netbanking) | Orders API. INR, plus the international currencies the Razorpay account has enabled. |
| Stripe | Redirect to Stripe Checkout and back | Checkout Sessions (`mode: payment`) on the makerspace's **own** Stripe account. No Stripe script runs on our pages. Takes every supported currency; three-decimal currencies must be multiples of 10. New Stripe accounts in India may be invite-only. |
| Offline | UPI QR, bank transfer, cash, cheque | Always available. The team records it. |

Keys are saved under **Settings → Payments and tax** (`payments.settings`: bookings managers).
Secrets are encrypted with AES-256-GCM using `PAYMENT_SECRETS_KEY` (32 random bytes, base64), bound to the
makerspace, and never sent back to the browser. Without that key the gateway section stays locked. Test mode
follows the key (`rzp_test_`, `sk_test_`).

## The payment record

Every charge starts as a `Payment` with its `PaymentLine`s and a frozen `taxSnapshot`, **before** any gateway
order exists, so the amount, tax and receipt are identical whichever way the customer pays.

A payment carries who paid as typed at the time (`customerName`, `customerEmail` lowercased,
`customerStateCode` for the GST place of supply, `customerGstin`), a nullable `bookingId` (a relation to `Booking`;
a trigger checks it is the same makerspace's) and, for bookings, a `purpose` (FULL, DEPOSIT, BALANCE,
DIFFERENCE). Line kinds are `BOOKING`, `ADD_ON` and `OTHER`.

| Status | Meaning |
| --- | --- |
| `PENDING` | A gateway attempt was started |
| `AWAITING_CONFIRMATION` | Offline money waiting for a second person (maker-checker) |
| `PAID` | Money received; document issued (or held, see below) |
| `WAIVED` | Reserved for forgiven charges; no document (bookings use a write-off instead) |
| `FAILED` | The gateway failed or the team rejected an offline payment |
| `CANCELLED` | Cancelled by the team, or closed by a newer attempt |

The entry points (`lib/payments/*`) take a customer and a list of charge items:

- `createPayment(tx, { makerspace, customer, currency, items, provider, status, bookingId? })` in `charges.ts`
  taxes each item (`chargeLines` in `tax.ts`) and writes the payment and its lines;
- `startCheckout({ makerspaceId, customer, currency, items, bookingId?, description, returnPath })` in
  `checkout.ts` creates the payment, then the gateway order;
- `recordOfflinePayment(tx, { makerspace, customer, currency, items, method, … })` in `offline.ts`.

Booking payments start from `startBookingPayment` (`lib/bookings/money/start.ts`), which locks the booking first and
keeps one open attempt per booking.

## Settling

`settlePayment` runs in one transaction: lock the payment's booking (if any), then the payment, mark it `PAID`,
allocate the document number and insert the document, then apply the payment to its booking
(`onBookingPaymentSettled`). Lock order is always **Booking → Payments (by id) → Refunds → DocumentCounter**;
anything that settles a payment or processes a refund looks the booking id up unlocked and locks the Booking first.

Money received is **never refused**. These still become `PAID` with a document, and are flagged for review:

- paid after the attempt was cancelled or failed (late capture);
- the makerspace was not active.

A **mismatched amount** is also `PAID` and flagged, but its document is **held**. The team either issues the
receipt on the amount received (lines are re-apportioned) or refunds.

## Webhooks

`POST /api/webhooks/razorpay/{code}` and `/api/webhooks/stripe/{code}`. The `{code}` is an unguessable
per-makerspace value shown in settings.

- The signature is checked with the makerspace's webhook secret (Razorpay: HMAC of the body; Stripe:
  `t.v1` with a five-minute tolerance).
- `ProcessedWebhookEvent (provider, eventId)` makes every event apply once.
- Business outcomes always answer **200**; unknown events are acknowledged; only infrastructure errors give 5xx,
  so the provider retries. Razorpay disables endpoints that keep failing, so this matters.
- Events used: Razorpay `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`. Stripe
  `checkout.session.completed` (when `payment_status=paid`), `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.created`, `refund.updated`,
  `refund.failed`.

## Reconcile

The `payments-reconcile` job (every five minutes, `lib/scheduled/index.ts`) polls open gateway attempts older
than five minutes through `fetchPayment`, and settles or fails them. A customer returning from Stripe, or
finishing Razorpay Checkout, settles straight away the same way. Attempts still open after a week are closed as
`FAILED`; a capture that still arrives is receipted and flagged.

## Offline payments and maker-checker

With **"A second person confirms offline payments"** on (Settings → Money and year), a payment recorded by one
person on the team counts only after someone else with `payments.record` confirms it. The receipt number is
allocated at confirmation. With it off, recorded payments are paid and receipted at once. A UPI or bank
reference is recorded once per makerspace (a partial unique index ignores rejected payments, so a corrected
one can be entered again).

## Refunds and credit notes

Refunds (`refunds.manage`: bookings managers) are append-only. Offline refunds are recorded as
money already handed back and processed at once. Gateway refunds go to the provider after the refund row
commits and stay `PENDING` until the provider (or its webhook) confirms; a timeout keeps them pending rather
than guessing. Each processed refund gets a **credit note** with tax apportioned pro rata.

A booking payment is refunded from its booking (the Payments page refuses it and says so), so the refund policy,
the booking's other payments and what is still owed stay in step; see "Booking money".

### Pending refund follow-up

The `refunds-reconcile` job (every five minutes) asks Razorpay or Stripe about gateway refunds still `PENDING`
after ten minutes, oldest-checked first, for up to 30 days: by the gateway refund id, or, when the original call
timed out before answering, by our refund id among the payment's refunds. Only the provider's answer settles or
fails a refund. Refunds pending for more than a day are flagged on the Payments page.

## Immutability

Database triggers in `prisma/migrations/0001_init` enforce, with column allowlists:

- a paid or waived payment may only gain settlement details and review flags (its amount, customer, booking
  once set, tax snapshot and references are fixed); it is never deleted;
- payment lines are written once (lines of an unpaid payment may be deleted with it);
- a tax document may only gain `cancelledAt`; never deleted;
- a refund may only move on from `PENDING`.

A makerspace that has taken payments cannot be deleted; a platform admin archives it instead.

## Documents

Numbers are gapless per makerspace, series and financial year: `PREFIX-2627-00042` for receipts and invoices,
`PREFIX-2627-C00042` for credit notes (at most 16 characters). PDFs are drawn on demand from the frozen
snapshot (`/api/documents/{id}`, for the team with `payments.view`, or the customer whose verified account
email matches the payment), so a rendering problem never burns a number. Amounts are printed with the ISO code
("INR 1,180.00"). Receipts and credit notes are attached to the payment emails.

## Dashboard

**Payments** lists every payment with filters (to confirm, needs review, paid, started, refunds, failed),
search by customer name, email, UTR or document number, and a page per payment with its lines, documents,
refunds and the actions the role allows (confirm, reject, cancel, release a held document, clear a flag,
refund).

## Finance ledger

Every money movement is also a row in `FinanceEntry` (append-only by trigger; `lib/finance/*`): a payment when it
becomes PAID (the amount captured), a refund when it is PROCESSED, and every repair payout, each posted by a trigger
in the same transaction (`0006_repairs_finance`, which also backfilled history). A bookings manager posts other income
and expenses by hand and corrects them only with a reversing entry. The Finance page shows money in, out and net by
period, category, way of paying and space; `/api/exports/finance` and `/api/exports/repairs` give CSV or Excel
(`?format=xlsx`). The hourly `finance-ledger-check` job audits any source without exactly one matching entry.

## Booking money

`lib/bookings/money/*`, on the obligation model of `lib/bookings/obligation.ts` (build plan, v2 amendments).

- **Caches by trigger.** `Booking.paidMinor` (PAID payments, captured amount) and `refundedMinor` (PROCESSED refunds)
  are written only by `booking_money_refresh` (migration `0003_booking_money`); `Booking_money_guard` refuses any
  other writer. The app writes `chargeMinor`. The hourly `booking-money-check` job audits any disagreement
  (`BOOKING_MONEY_MISMATCH`) and never rewrites money.
- **One step after every change.** `recomputeCharge` writes the charge (less `concessionMinor`), then refunds what
  was paid beyond it and isn't already on its way back (pending refunds, and failed ones nobody retried yet, which
  wait for a person). The refund kind says why: POLICY (customer cancel by the frozen tiers from `policyAnchorAt`),
  VENUE (everything back), RESCHEDULE (a cheaper time), DUPLICATE (paid twice), LATE_CAPTURE (paid after the booking
  ended), MANUAL (by the team), EXTERNAL (made in the provider's dashboard).
- **Allocation** (`allocate.ts`, pure): a refund splits over the booking's payments, gateway payments first, newest
  first, then offline ones; rows share a `refundGroupId`. Refunds of offline payments, or of a gateway that is no
  longer connected, are `offlineRequired`: a person hands the money back and records method and reference.
- **Sending after commit** (`send.ts`). Refunds are opened inside the booking's transaction and sent to the gateway
  after it commits: by the action that caused them, else by the `booking-refunds-send` job (every minute). A refund
  is claimed (`sentAt`) before the call; a claim older than 30 minutes without a provider id is looked up with the
  provider by our refund id before it is sent again.
- **Settling** (`settled.ts`): a HELD booking awaiting payment is confirmed; an EXPIRED hold is confirmed again when
  every time is still free (else LATE_CAPTURE refund); money for a cancelled or declined booking is refunded; money
  beyond the charge is a DUPLICATE refund. Any surprise flags the payment.
- **No money before approval.** Requests can't be paid; on approval PAY_NOW/DEPOSIT become due within
  `approvalPayWithinHours` (overdue: auto-cancel), pay later by its rule. Starting an attempt closes the booking's
  older open attempts (Stripe sessions are expired) and stretches a hold to the checkout window (Stripe 31 minutes,
  Razorpay 16). `booking-checkouts-close` closes attempts of bookings that ended.
- **Due dates** (`jobs.ts`): reminders at each `paymentReminderHoursBeforeDue` offset, then AUTO_CANCEL (a system
  cancel; a non-refundable deposit is kept) or NOTIFY_STAFF (the customer is told and the booking flagged in the
  audit log, at each `overdueReminderHoursAfterDue` offset). A dearer reschedule of a paid booking makes the
  difference due within the approval window.
- **The team** (`staff.ts`, booking page "Money"): record a desk payment (maker-checker applies), refund with a
  reason (beyond what is due it is a concession: the charge drops by the same amount), retry a failed refund (a new
  row, `retryOfId`), record a refund handed back offline, write off a balance, change the due date.
- **Provider-dashboard refunds**: a refund webhook that matches none of ours is noted (`GatewayRefundNotice`); after
  30 minutes `booking-refunds-external` records it as a PROCESSED, flagged EXTERNAL refund with a credit note.
- **Documents**: each payment gets its receipt or tax invoice (see GST.md), each processed refund a credit note, and
  every booking an unnumbered statement PDF (`/api/bookings/{slug}/{reference}/statement`) for the customer and staff.
- **Reconciliation** (`/dashboard/{slug}/payments/reconciliation`): refunds to finish, payments to review, open
  checkouts and 14 days of totals per provider.
