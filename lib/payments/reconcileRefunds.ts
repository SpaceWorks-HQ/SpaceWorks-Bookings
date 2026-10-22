import "server-only";

import { prisma } from "@/lib/db";
import { MAKERSPACE_FOR_PAYMENTS, type MakerspaceForPayments } from "./charges";
import { loadGateway } from "./config";
import { attachGatewayRefund, failRefund, processRefund } from "./refunds";

const MINUTE = 60_000;
/** Give the provider's answer and webhook a head start, then keep asking for a month (bank refunds are slow). */
const CHECK_AFTER_MS = 10 * MINUTE;
const CHECK_FOR_MS = 30 * 24 * 60 * MINUTE;
const RUN_EVERY_MS = 5 * MINUTE;
const BATCH = 50;

function state() {
  return globalThis as typeof globalThis & { __swbookRefundReconcileAt?: number };
}

/**
 * Ask Razorpay or Stripe about gateway refunds still PENDING, so a missed webhook or a timeout never leaves one
 * hanging. Refunds checked longest ago go first. Only the provider's answer settles or fails a refund; one it
 * can't find, or can't be asked about, stays pending (and the Payments page flags it after a day).
 */
export async function reconcileGatewayRefunds(now = new Date(), force = false) {
  const runtime = state();
  if (!force && runtime.__swbookRefundReconcileAt && now.getTime() - runtime.__swbookRefundReconcileAt < RUN_EVERY_MS) return { checked: 0, settled: 0, skipped: true };
  runtime.__swbookRefundReconcileAt = now.getTime();

  const pending = await prisma.refund.findMany({
    where: {
      status: "PENDING",
      createdAt: { lte: new Date(now.getTime() - CHECK_AFTER_MS), gte: new Date(now.getTime() - CHECK_FOR_MS) },
      payment: { provider: { in: ["RAZORPAY", "STRIPE"] }, gatewayPaymentId: { not: null } },
    },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: BATCH,
    select: { id: true, makerspaceId: true, gatewayRefundId: true, payment: { select: { provider: true, gatewayPaymentId: true } } },
  });
  const makerspaces = new Map<string, MakerspaceForPayments | null>();
  const gateways = new Map<string, Awaited<ReturnType<typeof loadGateway>>>();
  let settled = 0;
  for (const refund of pending) {
    await prisma.refund.updateMany({ where: { id: refund.id, status: "PENDING" }, data: { lastCheckedAt: now } });
    try {
      if (!gateways.has(refund.makerspaceId)) gateways.set(refund.makerspaceId, await loadGateway(refund.makerspaceId));
      const live = gateways.get(refund.makerspaceId);
      if (!live || live.provider !== refund.payment.provider || !refund.payment.gatewayPaymentId) continue;
      const result = await live.gateway.fetchRefund(live.credentials, { gatewayPaymentId: refund.payment.gatewayPaymentId, gatewayRefundId: refund.gatewayRefundId, refundId: refund.id });
      if (!result || result.status === "pending") continue;
      if (!makerspaces.has(refund.makerspaceId)) makerspaces.set(refund.makerspaceId, await prisma.makerspace.findUnique({ where: { id: refund.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS }));
      const makerspace = makerspaces.get(refund.makerspaceId);
      if (!makerspace) continue;
      await prisma.$transaction(async (tx) => {
        if (!refund.gatewayRefundId && result.gatewayRefundId) await attachGatewayRefund(tx, { makerspace, refundId: refund.id, gatewayRefundId: result.gatewayRefundId });
        if (result.status === "processed") await processRefund(tx, { makerspace, refundId: refund.id, gatewayRefundId: result.gatewayRefundId || null, now });
        else await failRefund(tx, { makerspace, refundId: refund.id, reason: "The provider reported the refund as failed." });
      });
      settled += 1;
    } catch {
      // One makerspace's bad keys or a provider outage must not stop the others.
      console.error("[refunds reconcile] one refund could not be checked");
    }
  }
  return { checked: pending.length, settled, skipped: false };
}
