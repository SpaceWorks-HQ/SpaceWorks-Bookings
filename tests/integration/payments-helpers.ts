import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { openTerm, upsertMember } from "@/lib/membership/service";
import { ORG_FOR_PAYMENTS, type OrgForPayments } from "@/lib/payments/charges";

/** Shared fixtures for the payments integration suites: one GST-registered organisation in Kerala. */
export const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
export const at = (iso: string) => new Date(iso);

export function ensurePaymentKey() {
  process.env.PAYMENT_SECRETS_KEY ??= randomBytes(32).toString("base64");
}

export async function createPaymentsOrg(options: { makerChecker?: boolean } = {}) {
  const created = await prisma.organisation.create({ data: { name: "Kunj-Company", slug: `kunj-${suffix}-${randomUUID().slice(0, 4)}`, status: "ACTIVE", stateCode: "KL", offlineConfirmationRequired: options.makerChecker ?? false } });
  await prisma.orgTaxSettings.create({ data: { organisationId: created.id, mode: "GST", gstin: "32ABCDE1234F1Z5", legalName: "Kunj Company Society", address: "Kochi", stateCode: "KL", rateBps: 1800, inclusive: true, receiptPrefix: "KUNJ" } });
  const plan = await prisma.membershipPlan.create({ data: { organisationId: created.id, name: "Annual", slug: `annual-${suffix}`, currency: "INR", priceNewMinor: 118_000, priceRenewalMinor: 118_000, joinMode: "OPEN" } });
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: created.id }, select: ORG_FOR_PAYMENTS });
  return { org, plan };
}

/** A member with an unpaid term on the plan (opened by a manager, so it waits for payment). */
export async function unpaidTerm(org: OrgForPayments, plan: Awaited<ReturnType<typeof createPaymentsOrg>>["plan"], name: string, now: Date, stateCode = "KL") {
  return prisma.$transaction(async (tx) => {
    const member = await upsertMember(tx, org.id, { email: `${name}-${suffix}@example.test`, name, stateCode, source: "MANUAL" });
    return openTerm(tx, { org, plan, memberId: member.id, byManager: true, actorUserId: null, now });
  });
}

export async function people(count: number) {
  return Promise.all(Array.from({ length: count }, (_, index) => prisma.user.create({ data: { email: `staff${index}-${suffix}-${randomUUID().slice(0, 4)}@example.test`, name: `Staff ${index}` } })));
}

/** Money rows are immutable by trigger, so test cleanup bypasses triggers for this organisation only. */
export async function removePaymentsOrg(organisationId: string, userIds: string[] = []) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRaw`DELETE FROM "RefundRequest" WHERE "organisationId" = ${organisationId}`;
    await tx.$executeRaw`DELETE FROM "TaxDocument" WHERE "organisationId" = ${organisationId}`;
    await tx.$executeRaw`DELETE FROM "Refund" WHERE "organisationId" = ${organisationId}`;
    await tx.$executeRaw`DELETE FROM "PaymentLine" WHERE "organisationId" = ${organisationId}`;
    await tx.$executeRaw`DELETE FROM "Payment" WHERE "organisationId" = ${organisationId}`;
    await tx.$executeRaw`DELETE FROM "ProcessedWebhookEvent" WHERE "organisationId" = ${organisationId}`;
    await tx.$executeRaw`DELETE FROM "LedgerEntry" WHERE "organisationId" = ${organisationId}`;
  });
  await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'organisationId' = ${organisationId}`;
  await prisma.organisation.delete({ where: { id: organisationId } }).catch(() => undefined);
  if (userIds.length) {
    await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
