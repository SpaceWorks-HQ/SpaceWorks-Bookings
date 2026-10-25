import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { lockPayment, lockPaymentBooking, MAKERSPACE_FOR_PAYMENTS } from "@/lib/payments/charges";
import { processRefund, refundableMinor } from "@/lib/payments/refunds";
import { SYSTEM } from "../actor";
import { recomputeCharge } from "../charge";
import { recordBookingEvent } from "../events";
import { netPaid } from "../obligation";
import { openRefundsMinor } from "./refunds";

/**
 * Refunds the provider reports that match none of ours were made in its dashboard. The webhook only notes them
 * (`GatewayRefundNotice`); after GRACE the job records each as a PROCESSED EXTERNAL refund on its payment, flagged for
 * the team, with a credit note. Money given back beyond what was due becomes a concession, so the customer doesn't
 * owe it again.
 */

const GRACE_MS = 30 * 60_000;

export async function recordExternalRefunds(now = new Date()): Promise<number> {
  const notices = await prisma.gatewayRefundNotice.findMany({ where: { resolvedAt: null, receivedAt: { lt: new Date(now.getTime() - GRACE_MS) } }, orderBy: { receivedAt: "asc" }, take: 50 });
  let recorded = 0;
  for (const notice of notices) {
    try {
      const done = await prisma.$transaction(async (tx) => {
        const resolve = () => tx.gatewayRefundNotice.update({ where: { provider_gatewayRefundId: { provider: notice.provider, gatewayRefundId: notice.gatewayRefundId } }, data: { resolvedAt: now } });
        if (await tx.refund.findFirst({ where: { gatewayRefundId: notice.gatewayRefundId }, select: { id: true } })) return resolve().then(() => false);
        const payment = notice.gatewayPaymentId
          ? await tx.payment.findFirst({ where: { makerspaceId: notice.makerspaceId, provider: notice.provider, gatewayPaymentId: notice.gatewayPaymentId, status: "PAID" }, select: { id: true } })
          : null;
        if (!payment) {
          await recordAuditEvent({ action: "PAYMENT_WEBHOOK_UNMATCHED", actorUserId: null, makerspaceId: notice.makerspaceId, targetType: "Webhook", targetId: notice.gatewayRefundId.slice(0, 120), metadata: { provider: notice.provider, type: "refund-processed" }, client: tx });
          return resolve().then(() => false);
        }
        const bookingId = await lockPaymentBooking(tx, notice.makerspaceId, payment.id);
        const locked = await lockPayment(tx, notice.makerspaceId, payment.id);
        const amount = Math.min(notice.amountMinor, await refundableMinor(tx, locked));
        if (amount <= 0) return resolve().then(() => false);
        const booking = bookingId ? await tx.booking.findUniqueOrThrow({ where: { id: bookingId } }) : null;
        if (booking) {
          const due = Math.max(0, netPaid(booking) - booking.chargeMinor - (await openRefundsMinor(tx, booking.id)));
          if (amount > due) await tx.booking.update({ where: { id: booking.id }, data: { concessionMinor: { increment: amount - due } } });
        }
        const refund = await tx.refund.create({
          data: { makerspaceId: notice.makerspaceId, paymentId: payment.id, currency: locked.currency, amountMinor: amount, kind: "EXTERNAL", reason: "Refunded in the payment provider's dashboard", gatewayRefundId: notice.gatewayRefundId, sentAt: now, flaggedAt: now, flagReason: "Refunded outside Space Works Bookings; check it was meant." },
        });
        const makerspace = await tx.makerspace.findUniqueOrThrow({ where: { id: notice.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
        await processRefund(tx, { makerspace, refundId: refund.id, gatewayRefundId: notice.gatewayRefundId, now });
        if (booking) {
          await recordBookingEvent(tx, { makerspaceId: notice.makerspaceId, bookingId: booking.id, kind: "refund", actor: SYSTEM, data: { kind: "EXTERNAL", amountMinor: amount, refundIds: [refund.id] } });
          await recomputeCharge(tx, booking.id, { refundKind: "EXTERNAL", now });
        }
        await resolve();
        return true;
      });
      if (done) recorded += 1;
    } catch {
      console.error("[refunds] an external refund could not be recorded");
    }
  }
  return recorded;
}
