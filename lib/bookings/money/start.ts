import "server-only";

import type { Booking, PaymentPurpose, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { startCheckout } from "@/lib/payments/checkout";
import { loadGateway } from "@/lib/payments/config";
import type { TaxSnapshot } from "@/lib/payments/tax";
import { assertCanActOn } from "../access";
import type { Actor } from "../actor";
import { lockBooking, type Tx } from "../db";
import { invalidState } from "../errors";
import { balanceDue, netPaid } from "../obligation";

/**
 * Online payment for a booking. Nothing is taken before approval; a HELD booking pays its deposit (DEPOSIT mode)
 * or everything; a confirmed one pays what is left (BALANCE, or DIFFERENCE after a dearer reschedule). Starting an
 * attempt closes the booking's older open attempts (one open payment per booking) and stretches a checkout hold so
 * the provider's checkout can't outlive it (Stripe Checkout lasts at least 30 minutes).
 */

const STRIPE_MINIMUM_MS = 31 * 60_000;
const RAZORPAY_WINDOW_MS = 16 * 60_000;

export type PaymentPlan = { amountMinor: number; purpose: PaymentPurpose };

/** What to charge now (pure): `full` asks to pay everything on a deposit booking. */
export function paymentPlan(booking: Pick<Booking, "status" | "awaitingPayment" | "chargeMode" | "chargeMinor" | "depositMinor" | "paidMinor" | "refundedMinor" | "writtenOffAt">, options: { full?: boolean; rescheduledSincePaid?: boolean } = {}): PaymentPlan | null {
  if (booking.writtenOffAt) return null;
  if (booking.status === "HELD" && !booking.awaitingPayment) return null;
  if (booking.status !== "HELD" && booking.status !== "CONFIRMED") return null;
  const paid = netPaid(booking);
  const balance = balanceDue(booking.chargeMinor, booking);
  if (balance <= 0) return null;
  if (booking.status === "HELD" && booking.chargeMode === "DEPOSIT" && !options.full && booking.depositMinor > paid) return { amountMinor: Math.min(balance, booking.depositMinor - paid), purpose: "DEPOSIT" };
  if (paid <= 0) return { amountMinor: balance, purpose: "FULL" };
  return { amountMinor: balance, purpose: options.rescheduledSincePaid ? "DIFFERENCE" : "BALANCE" };
}

async function prepare(tx: Tx, input: { makerspaceId: string; bookingId: string; actor: Actor; full?: boolean; now: Date }) {
  const booking = await lockBooking(tx, input.makerspaceId, input.bookingId);
  assertCanActOn(booking, input.actor, "payments.record");
  if (booking.status === "REQUESTED") throw invalidState("Payment opens once the makerspace approves your request.");
  const lastPaid = await tx.payment.findFirst({ where: { bookingId: booking.id, status: "PAID" }, orderBy: { paidAt: "desc" }, select: { paidAt: true } });
  const rescheduled = lastPaid?.paidAt ? await tx.bookingEvent.count({ where: { bookingId: booking.id, kind: "rescheduled", createdAt: { gt: lastPaid.paidAt } } }) : 0;
  const plan = paymentPlan(booking, { full: input.full, rescheduledSincePaid: rescheduled > 0 });
  if (!plan) throw invalidState("Nothing is due on this booking now.");
  if (booking.status === "HELD" && booking.holdExpiresAt && booking.holdExpiresAt <= input.now) throw invalidState("Your hold has expired. Book the time again.");
  const open = await tx.$queryRaw<Array<{ id: string; provider: string; gatewayOrderId: string | null }>>`SELECT "id", "provider"::text, "gatewayOrderId" FROM "Payment" WHERE "bookingId" = ${booking.id} AND "status" = 'PENDING' ORDER BY "id" FOR UPDATE`;
  if (open.length) await tx.payment.updateMany({ where: { id: { in: open.map((row) => row.id) } }, data: { status: "CANCELLED", note: "Closed: a newer payment attempt was started." } });
  const provider = (await tx.makerspacePaymentSettings.findUnique({ where: { makerspaceId: input.makerspaceId }, select: { provider: true } }))?.provider ?? "NONE";
  let expiresAt: Date | undefined;
  if (booking.status === "HELD") {
    const minimum = new Date(input.now.getTime() + (provider === "STRIPE" ? STRIPE_MINIMUM_MS : RAZORPAY_WINDOW_MS));
    expiresAt = booking.holdExpiresAt && booking.holdExpiresAt > minimum ? booking.holdExpiresAt : minimum;
    await tx.booking.update({ where: { id: booking.id }, data: { holdExpiresAt: expiresAt } });
  }
  const space = await tx.space.findFirstOrThrow({ where: { id: booking.spaceId, makerspaceId: input.makerspaceId }, select: { name: true } });
  return { booking, plan, expiresAt, spaceName: space.name, closed: open.filter((row) => row.gatewayOrderId) };
}

/** Start the checkout; the caller then hands the result to Razorpay Checkout.js or redirects to Stripe. */
export async function startBookingPayment(input: { makerspaceId: string; bookingId: string; actor: Actor; full?: boolean; returnPath: string; now?: Date }) {
  const now = input.now ?? new Date();
  const { booking, plan, expiresAt, spaceName, closed } = await prisma.$transaction((tx) => prepare(tx, { ...input, now }));
  await expireClosedCheckouts(input.makerspaceId, closed);
  const tax = (booking.priceSnapshot as Prisma.JsonObject | null)?.tax as TaxSnapshot | undefined;
  return startCheckout({
    makerspaceId: input.makerspaceId,
    customer: { name: booking.contactName, email: booking.contactEmail, stateCode: tax?.supplierState ?? null },
    currency: booking.currency,
    items: [{ kind: "BOOKING", description: `${spaceName} · ${booking.reference}${plan.purpose === "DEPOSIT" ? " (deposit)" : ""}`, amountMinor: plan.amountMinor }],
    bookingId: booking.id,
    purpose: plan.purpose,
    // Booking prices already include tax: split the amount owed instead of adding tax to it.
    taxSnapshot: tax ? { ...tax, inclusive: true } : undefined,
    expiresAt,
    description: `${spaceName} booking ${booking.reference}`,
    returnPath: input.returnPath,
  });
}

/** Stop provider checkouts we closed so they can't be paid any more (best effort; late captures are refunded). */
export async function expireClosedCheckouts(makerspaceId: string, closed: Array<{ provider: string; gatewayOrderId: string | null }>) {
  const stripe = closed.filter((row) => row.provider === "STRIPE" && row.gatewayOrderId);
  if (stripe.length === 0) return;
  const live = await loadGateway(makerspaceId).catch(() => null);
  if (!live || live.provider !== "STRIPE" || !live.gateway.expireCheckout) return;
  for (const row of stripe) await live.gateway.expireCheckout(live.credentials, row.gatewayOrderId!).catch(() => console.error("[payments] expiring a Stripe checkout failed"));
}
