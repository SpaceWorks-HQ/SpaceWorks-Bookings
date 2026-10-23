import "server-only";

import type { Makerspace, Payment, PaymentProvider, PaymentPurpose, PaymentStatus, Prisma } from "@prisma/client";
import { chargeLines, placeOfSupply, resolveTaxSnapshot, sumSplits, type ChargeItem, type TaxSnapshot } from "./tax";

type Tx = Prisma.TransactionClient;
export type MakerspaceForPayments = Pick<Makerspace, "id" | "name" | "slug" | "status" | "timezone" | "financialYearStartMonth" | "offlineConfirmationRequired" | "addressLine" | "city" | "stateCode" | "postalCode" | "contactEmail" | "locale" | "logoUrl">;

export const MAKERSPACE_FOR_PAYMENTS = {
  id: true, name: true, slug: true, status: true, timezone: true, financialYearStartMonth: true, offlineConfirmationRequired: true,
  addressLine: true, city: true, stateCode: true, postalCode: true, contactEmail: true, locale: true, logoUrl: true,
} satisfies Prisma.MakerspaceSelect;

export class PaymentError extends Error {
  override name = "PaymentError";
}

/** Who pays, as typed at the time. The state code is the GST place of supply. */
export type PaymentCustomer = { name: string; email: string; stateCode?: string | null; gstin?: string | null };

/**
 * Create a payment with its tax snapshot and taxed lines. What it pays for is the caller's business:
 * `bookingId` links it to a booking once bookings exist (Phase 2 locks the booking before calling this).
 */
export async function createPayment(
  tx: Tx,
  args: {
    makerspace: MakerspaceForPayments;
    customer: PaymentCustomer;
    currency: string;
    items: ChargeItem[];
    provider: PaymentProvider;
    status: Extract<PaymentStatus, "PENDING" | "AWAITING_CONFIRMATION">;
    bookingId?: string | null;
    purpose?: PaymentPurpose | null;
    /** A booking's frozen tax snapshot (inclusive, so the items are what the customer owes); default: current settings. */
    taxSnapshot?: TaxSnapshot;
    method?: string | null;
    utr?: string | null;
    reference?: string | null;
    note?: string;
    recordedById?: string | null;
  },
): Promise<Payment> {
  const snapshot = args.taxSnapshot ?? resolveTaxSnapshot(await tx.makerspaceTaxSettings.findUnique({ where: { makerspaceId: args.makerspace.id } }), args.currency);
  const lines = chargeLines(args.items, snapshot, placeOfSupply(args.customer.stateCode, snapshot));
  if (lines.length === 0) throw new PaymentError("Nothing is due.");
  const totals = sumSplits(lines);
  return tx.payment.create({
    data: {
      makerspaceId: args.makerspace.id,
      bookingId: args.bookingId ?? null,
      purpose: args.purpose ?? null,
      customerName: args.customer.name,
      customerEmail: args.customer.email.trim().toLowerCase(),
      customerStateCode: args.customer.stateCode ?? null,
      customerGstin: args.customer.gstin ?? null,
      status: args.status,
      provider: args.provider,
      method: args.method ?? null,
      currency: args.currency,
      amountMinor: totals.amountMinor,
      utr: args.utr ?? null,
      reference: args.reference ?? null,
      note: args.note ?? "",
      recordedById: args.recordedById ?? null,
      taxSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      lines: { create: lines.map((line) => ({ currency: args.currency, ...line })) },
    },
  });
}

/**
 * Lock order is Booking → Payments → Refunds → DocumentCounter. A payment or refund of a booking changes the
 * booking's money caches (triggers), so anything settling one locks the booking first: look its id up unlocked,
 * lock the Booking, then the Payment.
 */
export async function lockPaymentBooking(tx: Tx, makerspaceId: string, paymentId: string): Promise<string | null> {
  const row = await tx.payment.findFirst({ where: { id: paymentId, makerspaceId }, select: { bookingId: true } });
  if (!row?.bookingId) return null;
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${row.bookingId} AND "makerspaceId" = ${makerspaceId} FOR UPDATE`;
  return row.bookingId;
}

/** Lock one payment of the makerspace for an update. */
export async function lockPayment(tx: Tx, makerspaceId: string, paymentId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} AND "makerspaceId" = ${makerspaceId} FOR UPDATE`;
  if (rows.length === 0) throw new PaymentError("Payment not found.");
  return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
}
