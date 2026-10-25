import "server-only";

import { prisma } from "@/lib/db";
import { MAKERSPACE_FOR_PAYMENTS, type MakerspaceForPayments } from "@/lib/payments/charges";
import { loadGateway } from "@/lib/payments/config";
import { attachGatewayRefund, processRefund } from "@/lib/payments/refunds";
import { sendRefundToGateway } from "@/lib/payments/refundGateway";

/**
 * Booking refunds are opened inside the booking's transaction and sent to the gateway after it commits: the action
 * that caused them sends at once, and the `booking-refunds-send` job picks up anything left (refunds opened by
 * webhooks or jobs, or an action that stopped half way). A refund is claimed (`sentAt`) before the provider is
 * called, so two senders never both send it. A claim older than RESEND_AFTER without a provider id is checked with
 * the provider (by our refund id) before it is sent again, so a crash between claim and call can't lose a refund
 * and a crash after the call can't refund twice.
 */

const RESEND_AFTER_MS = 30 * 60_000;
const BATCH = 50;

async function claim(refundId: string, now: Date, stale: boolean) {
  const claimed = await prisma.refund.updateMany({
    where: { id: refundId, status: "PENDING", offlineRequired: false, gatewayRefundId: null, ...(stale ? { sentAt: { lt: new Date(now.getTime() - RESEND_AFTER_MS) } } : { sentAt: null }) },
    data: { sentAt: now },
  });
  return claimed.count === 1;
}

async function sendOne(refundId: string, makerspaces: Map<string, MakerspaceForPayments | null>, now: Date, stale = false) {
  if (!(await claim(refundId, now, stale))) return false;
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: { select: { provider: true, gatewayPaymentId: true } } } });
  if (!makerspaces.has(refund.makerspaceId)) makerspaces.set(refund.makerspaceId, await prisma.makerspace.findUnique({ where: { id: refund.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS }));
  const makerspace = makerspaces.get(refund.makerspaceId);
  if (!makerspace || refund.payment.provider === "OFFLINE") return false;
  if (stale && refund.payment.gatewayPaymentId) {
    // The earlier attempt may have reached the provider: ask before sending again.
    const live = await loadGateway(makerspace.id);
    const found = live && live.provider === refund.payment.provider
      ? await live.gateway.fetchRefund(live.credentials, { gatewayPaymentId: refund.payment.gatewayPaymentId, gatewayRefundId: null, refundId: refund.id }).catch(() => undefined)
      : undefined;
    if (found === undefined) return false;
    if (found) {
      await prisma.$transaction(async (tx) => {
        if (found.gatewayRefundId) await attachGatewayRefund(tx, { makerspace, refundId: refund.id, gatewayRefundId: found.gatewayRefundId });
        if (found.status === "processed") await processRefund(tx, { makerspace, refundId: refund.id, gatewayRefundId: found.gatewayRefundId || null, now });
      });
      return true;
    }
  }
  const outcome = await sendRefundToGateway(makerspace, { refund, gateway: { provider: refund.payment.provider, gatewayPaymentId: refund.payment.gatewayPaymentId } });
  return outcome.ok;
}

/** Send refunds just opened by an action, after its transaction committed. Never throws. */
export async function sendBookingRefunds(refundIds: string[] | undefined, now = new Date()): Promise<void> {
  if (!refundIds?.length) return;
  const makerspaces = new Map<string, MakerspaceForPayments | null>();
  for (const id of refundIds) {
    try {
      await sendOne(id, makerspaces, now);
    } catch {
      console.error("[refunds] sending a booking refund failed; the send job will retry");
    }
  }
}

/** Job: send gateway refunds nobody sent yet, and re-check claims that never got a provider id. */
export async function sendPendingBookingRefunds(now = new Date()): Promise<number> {
  const rows = await prisma.refund.findMany({
    where: {
      status: "PENDING", offlineRequired: false, gatewayRefundId: null, payment: { provider: { in: ["RAZORPAY", "STRIPE"] }, bookingId: { not: null } },
      OR: [{ sentAt: null }, { sentAt: { lt: new Date(now.getTime() - RESEND_AFTER_MS) } }],
    },
    orderBy: { createdAt: "asc" }, take: BATCH, select: { id: true, sentAt: true },
  });
  const makerspaces = new Map<string, MakerspaceForPayments | null>();
  let sent = 0;
  for (const row of rows) {
    try {
      if (await sendOne(row.id, makerspaces, now, row.sentAt !== null)) sent += 1;
    } catch {
      console.error("[refunds] a pending booking refund could not be sent");
    }
  }
  return sent;
}
