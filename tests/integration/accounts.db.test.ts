import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { OrgForPayments } from "@/lib/payments/charges";
import { createPaymentsOrg, people, removePaymentsOrg } from "./payments-helpers";

let org: OrgForPayments;
let staff: Array<{ id: string }>;

beforeAll(async () => {
  ({ org } = await createPaymentsOrg());
  staff = await people(1);
});

afterAll(async () => {
  if (org) await removePaymentsOrg(org.id, staff.map((person) => person.id));
  await prisma.$disconnect();
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  organisationId: org.id,
  direction: "PAYMENT" as const,
  occurredOn: new Date("2026-07-01T00:00:00Z"),
  category: "Rent",
  currency: "INR",
  amountMinor: 1_500_000,
  method: "bank_transfer",
  ...overrides,
});

describe.sequential("ledger entries", () => {
  it("are voided once with a reason, and otherwise never change or disappear", async () => {
    const row = await prisma.ledgerEntry.create({ data: { ...entry(), recordedById: staff[0].id } });
    await expect(prisma.ledgerEntry.update({ where: { id: row.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(prisma.ledgerEntry.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.ledgerEntry.update({ where: { id: row.id }, data: { voidedAt: new Date() } })).rejects.toThrow();

    const voided = await prisma.ledgerEntry.update({ where: { id: row.id }, data: { voidedAt: new Date(), voidedById: staff[0].id, voidReason: "Entered twice" } });
    expect(voided).toMatchObject({ voidReason: "Entered twice", amountMinor: 1_500_000 });
    await expect(prisma.ledgerEntry.update({ where: { id: row.id }, data: { voidReason: "Changed my mind" } })).rejects.toThrow();
  });

  it("refuses zero amounts, unknown methods and malformed currencies", async () => {
    await expect(prisma.ledgerEntry.create({ data: entry({ amountMinor: 0 }) })).rejects.toThrow();
    await expect(prisma.ledgerEntry.create({ data: entry({ method: "barter" }) })).rejects.toThrow();
    await expect(prisma.ledgerEntry.create({ data: entry({ currency: "inr" }) })).rejects.toThrow();
    await expect(prisma.ledgerEntry.create({ data: entry({ category: "" }) })).rejects.toThrow();
  });

  it("keeps one opening balance per year and currency", async () => {
    const key = { organisationId_financialYear_currency: { organisationId: org.id, financialYear: "2026-27", currency: "INR" } };
    await prisma.openingBalance.upsert({ where: key, create: { organisationId: org.id, financialYear: "2026-27", currency: "INR", cashMinor: 10_000, bankMinor: 250_000 }, update: {} });
    await prisma.openingBalance.upsert({ where: key, create: { organisationId: org.id, financialYear: "2026-27", currency: "INR" }, update: { cashMinor: 20_000 } });
    expect(await prisma.openingBalance.findUniqueOrThrow({ where: key })).toMatchObject({ cashMinor: 20_000, bankMinor: 250_000 });
    await expect(prisma.openingBalance.create({ data: { organisationId: org.id, financialYear: "26-27", currency: "INR" } })).rejects.toThrow();
  });
});
