import "server-only";

import type { Organisation, Payment, PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";
import { chargeLines, placeOfSupply, resolveTaxSnapshot, sumSplits, type ChargeItem } from "./tax";

type Tx = Prisma.TransactionClient;
export type OrgForPayments = Pick<Organisation, "id" | "name" | "slug" | "status" | "timezone" | "financialYearStartMonth" | "offlineConfirmationRequired" | "addressLine" | "city" | "stateCode" | "postalCode" | "contactEmail" | "locale" | "logoUrl">;

export const ORG_FOR_PAYMENTS = {
  id: true, name: true, slug: true, status: true, timezone: true, financialYearStartMonth: true, offlineConfirmationRequired: true,
  addressLine: true, city: true, stateCode: true, postalCode: true, contactEmail: true, locale: true, logoUrl: true,
} satisfies Prisma.OrganisationSelect;

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
    org: OrgForPayments;
    customer: PaymentCustomer;
    currency: string;
    items: ChargeItem[];
    provider: PaymentProvider;
    status: Extract<PaymentStatus, "PENDING" | "AWAITING_CONFIRMATION">;
    bookingId?: string | null;
    method?: string | null;
    utr?: string | null;
    reference?: string | null;
    note?: string;
    recordedById?: string | null;
  },
): Promise<Payment> {
  const settings = await tx.orgTaxSettings.findUnique({ where: { organisationId: args.org.id } });
  const snapshot = resolveTaxSnapshot(settings, args.currency);
  const lines = chargeLines(args.items, snapshot, placeOfSupply(args.customer.stateCode, snapshot));
  if (lines.length === 0) throw new PaymentError("Nothing is due.");
  const totals = sumSplits(lines);
  return tx.payment.create({
    data: {
      organisationId: args.org.id,
      bookingId: args.bookingId ?? null,
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

/** Lock one payment of the organisation for an update. */
export async function lockPayment(tx: Tx, organisationId: string, paymentId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  if (rows.length === 0) throw new PaymentError("Payment not found.");
  return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
}
