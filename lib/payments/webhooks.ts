import "server-only";

import type { PaymentProvider, Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { MAKERSPACE_FOR_PAYMENTS, type MakerspaceForPayments } from "./charges";
import { credentialsOf, GATEWAYS } from "./config";
import type { GatewayEvent } from "./gateway";
import { failRefund, processRefund } from "./refunds";
import { failPayment, settlePayment } from "./settle";

type Tx = Prisma.TransactionClient;
export type WebhookOutcome = { status: number; body: string };

async function findPayment(tx: Tx, makerspaceId: string, provider: PaymentProvider, paymentId: string | null, orderId: string | null) {
  if (paymentId) {
    const byId = await tx.payment.findFirst({ where: { id: paymentId, makerspaceId, provider }, select: { id: true } });
    if (byId) return byId;
  }
  if (orderId) return tx.payment.findFirst({ where: { makerspaceId, provider, gatewayOrderId: orderId }, select: { id: true } });
  return null;
}

async function findRefund(tx: Tx, makerspaceId: string, refundId: string | null, gatewayRefundId: string) {
  if (refundId) {
    const byId = await tx.refund.findFirst({ where: { id: refundId, makerspaceId }, select: { id: true, status: true } });
    if (byId) return byId;
  }
  return gatewayRefundId ? tx.refund.findFirst({ where: { makerspaceId, gatewayRefundId }, select: { id: true, status: true } }) : null;
}

async function unmatched(tx: Tx, makerspace: MakerspaceForPayments, provider: PaymentProvider, event: GatewayEvent) {
  await recordAuditEvent({ action: "PAYMENT_WEBHOOK_UNMATCHED", actorUserId: null, makerspaceId: makerspace.id, targetType: "Webhook", targetId: event.eventId.slice(0, 120), metadata: { provider, type: event.type }, client: tx });
}

async function apply(tx: Tx, makerspace: MakerspaceForPayments, provider: PaymentProvider, event: GatewayEvent) {
  switch (event.type) {
    case "captured": {
      const payment = await findPayment(tx, makerspace.id, provider, event.paymentId, event.orderId);
      if (!payment) return unmatched(tx, makerspace, provider, event);
      await settlePayment(tx, { makerspace, paymentId: payment.id, capture: { gatewayPaymentId: event.gatewayPaymentId, amountMinor: event.amountMinor, currency: event.currency, method: event.method } });
      return;
    }
    case "failed": {
      const payment = await findPayment(tx, makerspace.id, provider, event.paymentId, event.orderId);
      if (payment) await failPayment(tx, { makerspace, paymentId: payment.id, reason: event.reason });
      return;
    }
    case "refund-processed": {
      const refund = await findRefund(tx, makerspace.id, event.refundId, event.gatewayRefundId);
      // A refund we closed as failed that the provider later completed: record it for a manager, never 5xx.
      if (!refund || refund.status === "FAILED") return unmatched(tx, makerspace, provider, event);
      await processRefund(tx, { makerspace, refundId: refund.id, gatewayRefundId: event.gatewayRefundId });
      return;
    }
    case "refund-failed": {
      const refund = await findRefund(tx, makerspace.id, event.refundId, event.gatewayRefundId);
      if (refund) await failRefund(tx, { makerspace, refundId: refund.id, reason: event.reason });
      return;
    }
    case "ignored":
      return;
  }
}

/**
 * Verify and apply one gateway webhook. Business outcomes always answer 200 (a late or mismatched payment
 * is recorded and flagged, never refused), unknown events are acknowledged, and only infrastructure errors
 * escape as exceptions so the route answers 5xx and the provider retries. Each event applies once.
 */
export async function handleWebhook(provider: Exclude<PaymentProvider, "OFFLINE">, code: string, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(code)) return { status: 404, body: "Not found" };
  const settings = await prisma.makerspacePaymentSettings.findUnique({ where: { webhookPublicCode: code } });
  if (!settings || settings.provider !== provider) return { status: 404, body: "Not found" };
  const credentials = credentialsOf(settings);
  const gateway = GATEWAYS[provider];
  if (!credentials || !gateway.verifyWebhook(credentials, rawBody, headers)) return { status: 401, body: "Invalid signature" };

  let event: GatewayEvent;
  try {
    event = gateway.parseEvent(rawBody, headers);
  } catch {
    return { status: 400, body: "Invalid payload" };
  }
  if (event.type === "ignored" || !event.eventId) return { status: 200, body: "Ignored" };

  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: settings.makerspaceId }, select: MAKERSPACE_FOR_PAYMENTS });
  const applied = await prisma.$transaction(async (tx) => {
    const fresh = await tx.processedWebhookEvent.createMany({ data: [{ provider, eventId: event.eventId.slice(0, 200), makerspaceId: makerspace.id }], skipDuplicates: true });
    if (fresh.count === 0) return false;
    await apply(tx, makerspace, provider, event);
    return true;
  });
  return { status: 200, body: applied ? "OK" : "Duplicate" };
}
