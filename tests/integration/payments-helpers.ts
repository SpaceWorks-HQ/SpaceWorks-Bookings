import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { MAKERSPACE_FOR_PAYMENTS } from "@/lib/payments/charges";
import type { PaymentCustomer } from "@/lib/payments/charges";
import type { ChargeItem } from "@/lib/payments/tax";

/** Shared fixtures for the payments integration suites: one GST-registered makerspace in Kerala. */
export const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
export const at = (iso: string) => new Date(iso);

export function ensurePaymentKey() {
  process.env.PAYMENT_SECRETS_KEY ??= randomBytes(32).toString("base64");
}

export async function createPaymentsMakerspace(options: { makerChecker?: boolean } = {}) {
  const created = await prisma.makerspace.create({ data: { name: "Kunj-Company", slug: `kunj-${suffix}-${randomUUID().slice(0, 4)}`, status: "ACTIVE", stateCode: "KL", offlineConfirmationRequired: options.makerChecker ?? false } });
  await prisma.makerspaceTaxSettings.create({ data: { makerspaceId: created.id, mode: "GST", gstin: "32ABCDE1234F1Z5", legalName: "Kunj Company Society", address: "Kochi", stateCode: "KL", rateBps: 1800, inclusive: true, receiptPrefix: "KUNJ" } });
  return { makerspace: await prisma.makerspace.findUniqueOrThrow({ where: { id: created.id }, select: MAKERSPACE_FOR_PAYMENTS }) };
}

/** A customer and what they owe: until bookings exist (Phase 2), payments carry their own customer and items. */
export function customer(name: string, stateCode = "KL"): PaymentCustomer {
  return { name, email: `${name}-${suffix}@example.test`, stateCode };
}

export const ROOM_HIRE: ChargeItem[] = [{ kind: "BOOKING", description: "Meeting room, 2 hours", amountMinor: 118_000 }];

export async function people(count: number) {
  return Promise.all(Array.from({ length: count }, (_, index) => prisma.user.create({ data: { email: `staff${index}-${suffix}-${randomUUID().slice(0, 4)}@example.test`, name: `Staff ${index}` } })));
}

/** Money rows are immutable by trigger, so test cleanup bypasses triggers for this makerspace only. */
export async function removePaymentsMakerspace(makerspaceId: string, userIds: string[] = []) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRaw`DELETE FROM "FinanceEntry" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "TaxDocument" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "Refund" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "PaymentLine" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "Payment" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "ProcessedWebhookEvent" WHERE "makerspaceId" = ${makerspaceId}`;
  });
  await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'makerspaceId' = ${makerspaceId}`;
  await prisma.makerspace.delete({ where: { id: makerspaceId } }).catch(() => undefined);
  if (userIds.length) {
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
