import crypto from "node:crypto";
import type { BookingStatus } from "@prisma/client";
import { paymentState } from "@/lib/bookings/obligation";

/**
 * Outbound webhook events (pure). Each comes from one BookingEvent row; payloads carry ids, times and amounts only,
 * never names, emails, phone numbers or notes. Signature: `X-SpaceWorks-Signature: t=<unix seconds>,v1=<hex
 * HMAC-SHA256 of "<t>.<raw body>">` with the endpoint's secret (docs/API.md "Webhooks").
 */

export const WEBHOOK_EVENTS = [
  "booking.requested", "booking.confirmed", "booking.declined", "booking.expired", "booking.cancelled",
  "booking.rescheduled", "booking.moved", "booking.checked_in", "booking.no_show", "booking.completed",
  "payment.received", "refund.created", "booking.written_off",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const BY_KIND: Record<string, WebhookEvent> = {
  requested: "booking.requested", confirmed: "booking.confirmed", approved: "booking.confirmed", revived: "booking.confirmed",
  declined: "booking.declined", expired: "booking.expired", cancelled: "booking.cancelled", rescheduled: "booking.rescheduled",
  moved: "booking.moved", "checked-in": "booking.checked_in", "no-show": "booking.no_show", completed: "booking.completed",
  payment: "payment.received", refund: "refund.created", "written-off": "booking.written_off",
};

/** The webhook event for a BookingEvent kind, or null when it isn't published (holds, links, due dates…). */
export function webhookEventFor(kind: string): WebhookEvent | null {
  return BY_KIND[kind] ?? null;
}

type BookingForPayload = {
  id: string; reference: string; status: BookingStatus; spaceId: string; quantity: number; attendees: number; currency: string;
  totalMinor: number; chargeMinor: number; paidMinor: number; refundedMinor: number; paymentDueAt: Date | null; writtenOffAt: Date | null;
  space: { slug: string };
  occurrences: Array<{ id: string; startsAt: Date; endsAt: Date; status: string }>;
};

/** Event `data` the receiver may need, by event kind: amounts and ids only. */
const SAFE_DATA_KEYS = new Set(["amountMinor", "kind", "purpose", "paymentId", "refundIds", "scope", "whole", "keptFeeMinor", "from", "to", "fromSpaceId", "toSpaceId"]);

export function webhookPayload(input: {
  eventId: string; event: WebhookEvent; createdAt: Date; makerspaceSlug: string; occurrenceId: string | null;
  data: unknown; booking: BookingForPayload; now?: Date;
}) {
  const data = input.data && typeof input.data === "object" ? Object.fromEntries(Object.entries(input.data as Record<string, unknown>).filter(([key]) => SAFE_DATA_KEYS.has(key))) : {};
  const live = input.booking.occurrences.filter((row) => row.status !== "CANCELLED");
  return {
    id: input.eventId,
    type: input.event,
    createdAt: input.createdAt.toISOString(),
    makerspace: input.makerspaceSlug,
    data: {
      ...data,
      occurrenceId: input.occurrenceId,
      booking: {
        id: input.booking.id, reference: input.booking.reference, status: input.booking.status,
        space: { id: input.booking.spaceId, slug: input.booking.space.slug },
        quantity: input.booking.quantity, attendees: input.booking.attendees, currency: input.booking.currency,
        totalMinor: input.booking.totalMinor, chargeMinor: input.booking.chargeMinor, paidMinor: input.booking.paidMinor, refundedMinor: input.booking.refundedMinor,
        paymentState: paymentState(input.booking, input.now ?? new Date()),
        paymentDueAt: input.booking.paymentDueAt?.toISOString() ?? null,
        occurrences: input.booking.occurrences.map((row) => ({ id: row.id, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), status: row.status })),
        startsAt: live[0]?.startsAt.toISOString() ?? null,
      },
    },
  };
}

/** The signature header for a body sent at `unixSeconds` (pure). */
export function signWebhook(secret: string, body: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${crypto.createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex")}`;
}

/** Retry delays after each failed attempt; after the last, the delivery is FAILED. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

export function nextAttemptAfter(attempts: number, now: Date): Date | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}
