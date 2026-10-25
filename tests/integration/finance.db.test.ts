import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moneyBooking, payOnline, prisma, setupMoney, type MoneyFixture } from "./money-helpers";

const { postManualEntry, reverseEntry } = await import("@/lib/finance/ledger");
const { checkFinanceLedger } = await import("@/lib/finance/consistency");

let fixture: MoneyFixture;
const entriesFor = (sourceId: string) => prisma.financeEntry.findMany({ where: { sourceId } });

describe.sequential("the finance ledger", () => {
  beforeAll(async () => { fixture = await setupMoney({ chargeMode: "PAY_NOW" }); });
  afterAll(async () => { await fixture.cleanup(); });

  it("posts a settled payment and a processed refund once each, in their own transaction", async () => {
    const bookingId = await moneyBooking(fixture, [10, 12]);
    const { paymentId } = await payOnline(fixture, bookingId, 100_000);
    expect(await entriesFor(paymentId)).toEqual([expect.objectContaining({ direction: "IN", category: "BOOKING_PAYMENT", amountMinor: 100_000, method: "GATEWAY_RAZORPAY", bookingId, spaceId: fixture.space.id, sourceType: "PAYMENT" })]);
    // Touching the payment again never posts twice.
    await prisma.payment.update({ where: { id: paymentId }, data: { flaggedAt: new Date(), flagReason: "Checked" } });
    expect(await entriesFor(paymentId)).toHaveLength(1);
    const refund = await prisma.refund.create({ data: { makerspaceId: fixture.makerspaceId, paymentId, currency: "INR", amountMinor: 40_000, kind: "MANUAL", status: "PENDING", reason: "Partial" } });
    expect(await entriesFor(refund.id)).toHaveLength(0);
    await prisma.refund.update({ where: { id: refund.id }, data: { status: "PROCESSED", processedAt: new Date(), gatewayRefundId: `rfnd_${refund.id}` } });
    expect(await entriesFor(refund.id)).toEqual([expect.objectContaining({ direction: "OUT", category: "REFUND", amountMinor: 40_000, method: "GATEWAY_RAZORPAY", sourceType: "REFUND" })]);
    expect(await checkFinanceLedger(fixture.makerspaceId)).toEqual([]);
  });

  it("is append-only: corrections are reversals, once, of hand-posted entries", async () => {
    const entry = await postManualEntry({ makerspaceId: fixture.makerspaceId, actor: fixture.owner, direction: "OUT", category: "RENT", amountMinor: 2_500_000, method: "BANK_TRANSFER", reference: "NEFT-1", occurredAt: new Date(), note: "October rent" });
    expect(entry).toMatchObject({ currency: "INR", sourceType: "MANUAL", sourceId: entry.id });
    await expect(prisma.financeEntry.update({ where: { id: entry.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(prisma.financeEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
    const reversal = await reverseEntry({ makerspaceId: fixture.makerspaceId, actor: fixture.owner, entryId: entry.id, reason: "Posted twice" });
    expect(reversal).toMatchObject({ direction: "IN", category: "RENT", amountMinor: 2_500_000, reversesId: entry.id, sourceType: "REVERSAL" });
    await expect(reverseEntry({ makerspaceId: fixture.makerspaceId, actor: fixture.owner, entryId: entry.id, reason: "Again" })).rejects.toThrow("already reversed");
    const payment = await prisma.financeEntry.findFirstOrThrow({ where: { makerspaceId: fixture.makerspaceId, sourceType: "PAYMENT" } });
    await expect(reverseEntry({ makerspaceId: fixture.makerspaceId, actor: fixture.owner, entryId: payment.id, reason: "No" })).rejects.toThrow("corrected at their source");
  });

  it("keeps money with the bookings manager and refuses wrong categories and other makerspaces", async () => {
    const front = await fixture.staff("FRONT_DESK");
    const input = { makerspaceId: fixture.makerspaceId, direction: "OUT" as const, category: "UTILITIES" as const, amountMinor: 100, method: "CASH" as const, reference: null, occurredAt: new Date(), note: "Water" };
    await expect(postManualEntry({ ...input, actor: front })).rejects.toThrow();
    await expect(postManualEntry({ ...input, actor: fixture.owner, category: "BOOKING_PAYMENT" })).rejects.toThrow("Choose a category");
    await expect(postManualEntry({ ...input, actor: fixture.owner, direction: "IN" })).rejects.toThrow("Choose a category");
    const other = await setupMoney();
    try {
      const entry = await prisma.financeEntry.findFirstOrThrow({ where: { makerspaceId: fixture.makerspaceId, sourceType: "MANUAL" } });
      await expect(reverseEntry({ makerspaceId: other.makerspaceId, actor: other.owner, entryId: entry.id, reason: "x" })).rejects.toThrow("Entry not found.");
    } finally {
      await other.cleanup();
    }
  });
});
