import type { Booking } from "@prisma/client";
import type { Tx } from "../db";

/** Only reviewed, settled money not already committed to refunds can satisfy an upfront requirement. */
export async function hasRequiredUpfrontPayment(tx: Tx, booking: Pick<Booking, "id" | "makerspaceId" | "currency" | "chargeMode" | "totalMinor" | "concessionMinor" | "depositMinor">): Promise<boolean> {
  // Expiry clears chargeMinor, so use the frozen booking price when deciding whether to revive its slots.
  const total = Math.max(0, booking.totalMinor - booking.concessionMinor);
  const required = booking.chargeMode === "DEPOSIT" ? Math.min(total, booking.depositMinor) : total;
  const payments = await tx.payment.findMany({
    where: { bookingId: booking.id, makerspaceId: booking.makerspaceId, currency: booking.currency, status: "PAID", documentHeld: false },
    select: { amountMinor: true, capturedMinor: true, refunds: { select: { amountMinor: true, status: true, retry: { select: { id: true } } } } },
  });
  const available = payments.reduce((sum, payment) => {
    const returning = payment.refunds.filter((refund) => refund.status !== "FAILED" || !refund.retry).reduce((amount, refund) => amount + refund.amountMinor, 0);
    return sum + (payment.capturedMinor ?? payment.amountMinor) - returning;
  }, 0);
  return available >= required;
}
