import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { openTerm, upsertMember } from "@/lib/membership/service";
import { MAKERSPACE_FOR_PAYMENTS, type MakerspaceForPayments } from "@/lib/payments/charges";

/** Shared fixtures for the payments integration suites: one GST-registered makerspace in Kerala. */
export const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
export const at = (iso: string) => new Date(iso);

export function ensurePaymentKey() {
  process.env.PAYMENT_SECRETS_KEY ??= randomBytes(32).toString("base64");
}

export async function createPaymentsMakerspace(options: { makerChecker?: boolean } = {}) {
  const created = await prisma.makerspace.create({ data: { name: "Kunj-Company", slug: `kunj-${suffix}-${randomUUID().slice(0, 4)}`, status: "ACTIVE", stateCode: "KL", offlineConfirmationRequired: options.makerChecker ?? false } });
  await prisma.makerspaceTaxSettings.create({ data: { makerspaceId: created.id, mode: "GST", gstin: "32ABCDE1234F1Z5", legalName: "Kunj Company Society", address: "Kochi", stateCode: "KL", rateBps: 1800, inclusive: true, receiptPrefix: "KUNJ" } });
  const plan = await prisma.membershipPlan.create({ data: { makerspaceId: created.id, name: "Annual", slug: `annual-${suffix}`, currency: "INR", priceNewMinor: 118_000, priceRenewalMinor: 118_000, joinMode: "OPEN" } });
  const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: created.id }, select: MAKERSPACE_FOR_PAYMENTS });
  return { makerspace, plan };
}

/** A member with an unpaid term on the plan (opened by a manager, so it waits for payment). */
export async function unpaidTerm(makerspace: MakerspaceForPayments, plan: Awaited<ReturnType<typeof createPaymentsMakerspace>>["plan"], name: string, now: Date, stateCode = "KL") {
  return prisma.$transaction(async (tx) => {
    const member = await upsertMember(tx, makerspace.id, { email: `${name}-${suffix}@example.test`, name, stateCode, source: "MANUAL" });
    return openTerm(tx, { makerspace, plan, memberId: member.id, byManager: true, actorUserId: null, now });
  });
}

export async function people(count: number) {
  return Promise.all(Array.from({ length: count }, (_, index) => prisma.user.create({ data: { email: `staff${index}-${suffix}-${randomUUID().slice(0, 4)}@example.test`, name: `Staff ${index}` } })));
}

/** Money rows are immutable by trigger, so test cleanup bypasses triggers for this makerspace only. */
export async function removePaymentsMakerspace(makerspaceId: string, userIds: string[] = []) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRaw`DELETE FROM "RefundRequest" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "TaxDocument" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "Refund" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "PaymentLine" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "Payment" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "ProcessedWebhookEvent" WHERE "makerspaceId" = ${makerspaceId}`;
    await tx.$executeRaw`DELETE FROM "LedgerEntry" WHERE "makerspaceId" = ${makerspaceId}`;
  });
  await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'makerspaceId' = ${makerspaceId}`;
  await prisma.makerspace.delete({ where: { id: makerspaceId } }).catch(() => undefined);
  if (userIds.length) {
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
