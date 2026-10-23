# Payments

How money is taken, recorded and receipted. Tax rules are in [GST.md](GST.md).

Phase 0 keeps the payment infrastructure from the platform this product was forked from and decouples it
from what was being sold. Bookings arrive in Phase 1; Phase 2 connects payments to them (charge modes,
deposits, pay later, tiered refund policies, the booking ledger). Where this page says **Phase 2**, the code
does not exist yet.

## Ways to pay

Each makerspace picks **one** gateway, or none:

| Gateway | How the customer pays | Notes |
| --- | --- | --- |
| Razorpay | Checkout.js on our page (UPI, cards, netbanking) | Orders API. INR, plus the international currencies the Razorpay account has enabled. |
| Stripe | Redirect to Stripe Checkout and back | Checkout Sessions (`mode: payment`) on the makerspace's **own** Stripe account. No Stripe script runs on our pages. Takes every supported currency; three-decimal currencies must be multiples of 10. New Stripe accounts in India may be invite-only. |
| Offline | UPI QR, bank transfer, cash, cheque | Always available. The team records it. |

Keys are saved under **Settings → Payments and tax** (`payments.settings`: owner and space managers).
Secrets are encrypted with AES-256-GCM using `PAYMENT_SECRETS_KEY` (32 random bytes, base64), bound to the
makerspace, and never sent back to the browser. Without that key the gateway section stays locked. Test mode
follows the key (`rzp_test_`, `sk_test_`).

## The payment record

Every charge starts as a `Payment` with its `PaymentLine`s and a frozen `taxSnapshot`, **before** any gateway
order exists, so the amount, tax and receipt are identical whichever way the customer pays.

A payment carries who paid as typed at the time (`customerName`, `customerEmail` lowercased,
`customerStateCode` for the GST place of supply, `customerGstin`) and a nullable `bookingId`. In Phase 0
`bookingId` is a plain column with no relation; Phase 2 turns it into a relation to `Booking`. Line kinds are
`BOOKING`, `ADD_ON` and `OTHER`.

| Status | Meaning |
| --- | --- |
| `PENDING` | A gateway attempt was started |
| `AWAITING_CONFIRMATION` | Offline money waiting for a second person (maker-checker) |
| `PAID` | Money received; document issued (or held, see below) |
| `WAIVED` | Reserved for forgiven charges (Phase 2); no document |
| `FAILED` | The gateway failed or the team rejected an offline payment |
| `CANCELLED` | Cancelled by the team, or closed by a newer attempt |

The entry points (`lib/payments/*`) take a customer and a list of charge items:

- `createPayment(tx, { makerspace, customer, currency, items, provider, status, bookingId? })` in `charges.ts`
  taxes each item (`chargeLines` in `tax.ts`) and writes the payment and its lines;
- `startCheckout({ makerspaceId, customer, currency, items, bookingId?, description, returnPath })` in
  `checkout.ts` creates the payment, then the gateway order;
- `recordOfflinePayment(tx, { makerspace, customer, currency, items, method, … })` in `offline.ts`.

Phase 2 locks the booking before calling them and adds the per-booking "one open payment" rule.

## Settling

`settlePayment` runs in one transaction: lock the payment, mark it `PAID`, allocate the document number and
insert the document. It confirms nothing else; in Phase 2 the caller confirms the booking in the same
transaction. Lock order is always **payment → document counter**.

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

Refunds (`refunds.manage`: owner, space managers, treasurers) are append-only. Offline refunds are recorded as
money already handed back and processed at once. Gateway refunds go to the provider after the refund row
commits and stay `PENDING` until the provider (or its webhook) confirms; a timeout keeps them pending rather
than guessing. Each processed refund gets a **credit note** with tax apportioned pro rata.

There are no refund requests or refund policies yet. Phase 2 adds policy tiers per space and makerspace,
automatic refunds on cancellation, retries and the other scenarios in the build plan.

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
