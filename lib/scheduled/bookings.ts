import "server-only";
import type { JobDefinition } from "@/lib/queue/definitions";
import { expireHolds, expireRequests } from "@/lib/bookings/expiry";
import { autoMarkNoShows, completeOccurrences, sendBookingReminders } from "@/lib/bookings/jobs";
import { checkBookingMoney, closeEndedCheckouts, handleOverduePayments, sendPaymentReminders } from "@/lib/bookings/money/jobs";
import { recordExternalRefunds } from "@/lib/bookings/money/external";
import { sendPendingBookingRefunds } from "@/lib/bookings/money/send";
import { relayWebhookEvents } from "@/lib/integrations/webhooks/relay";
import { deliverDueWebhooks } from "@/lib/integrations/webhooks/deliver";
import { relayRepairWebhooks } from "@/lib/integrations/webhooks/relayRepairs";
import { expireRepairRequests } from "@/lib/repairs/requests";
import { auditFinanceLedger } from "@/lib/finance/consistency";

/** Booking upkeep (docs/BOOKINGS.md "Jobs"). Each run is idempotent; several workers may run it at once. */
export const BOOKING_JOBS: JobDefinition[] = [
  // Checkout holds free their slots within a minute of running out (holds are also released before any new hold).
  { area: "bookings-expire-holds", run: async (now) => { await expireHolds(now); } },
  { area: "bookings-expire-requests", run: async (now) => { await expireRequests(now); } },
  { area: "bookings-reminders", schedule: { every: 5 * 60_000 }, run: async (now) => { await sendBookingReminders(now); } },
  { area: "bookings-auto-no-show", schedule: { every: 5 * 60_000 }, run: async (now) => { await autoMarkNoShows(now); } },
  { area: "bookings-complete", schedule: { every: 5 * 60_000 }, run: async (now) => { await completeOccurrences(now); } },
  // Money (docs/PAYMENTS.md "Booking money"): refunds opened by webhooks or jobs go to the gateway after commit.
  { area: "booking-refunds-send", run: async (now) => { await sendPendingBookingRefunds(now); } },
  { area: "booking-checkouts-close", run: async () => { await closeEndedCheckouts(); } },
  { area: "booking-payments-overdue", schedule: { every: 5 * 60_000 }, run: async (now) => { await handleOverduePayments(now); } },
  { area: "booking-payment-reminders", schedule: { every: 5 * 60_000 }, run: async (now) => { await sendPaymentReminders(now); } },
  { area: "booking-refunds-external", schedule: { every: 10 * 60_000 }, run: async (now) => { await recordExternalRefunds(now); } },
  { area: "booking-money-check", schedule: { every: 60 * 60_000 }, run: async () => { await checkBookingMoney(); } },
  // Outbound webhooks (docs/API.md): the booking timeline is relayed into deliveries, sent with backoff.
  { area: "webhooks-relay", schedule: { every: 15_000 }, run: async (now) => { await relayWebhookEvents(now); } },
  { area: "webhooks-relay-repairs", schedule: { every: 15_000 }, run: async (now) => { await relayRepairWebhooks(now); } },
  // Repairs and the finance ledger (docs/DECISIONS.md): unanswered requests expire; the ledger is checked hourly.
  { area: "repairs-expire-requests", schedule: { every: 5 * 60_000 }, run: async (now) => { await expireRepairRequests(now); } },
  { area: "finance-ledger-check", schedule: { every: 60 * 60_000 }, run: async () => { await auditFinanceLedger(); } },
  { area: "webhooks-deliver", schedule: { every: 10_000 }, run: async (now) => { await deliverDueWebhooks(now); } },
];
