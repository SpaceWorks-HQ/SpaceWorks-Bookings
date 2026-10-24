import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createPayment, type MakerspaceForPayments } from "@/lib/payments/charges";
import { cancelPayment, confirmOfflinePayment, recordOfflinePayment, rejectOfflinePayment } from "@/lib/payments/offline";
import { createRefund } from "@/lib/payments/refunds";
import { settlePayment } from "@/lib/payments/settle";
import { at, createPaymentsMakerspace, customer, people, removePaymentsMakerspace, ROOM_HIRE } from "./payments-helpers";

let makerspace: MakerspaceForPayments;
let staff: Array<{ id: string }>;
const june = at("2026-06-15T06:00:00Z");
const offline = (name: string, extra: { method?: "cash" | "upi"; utr?: string; reference?: string; stateCode?: string; bookingId?: string } = {}) =>
  prisma.$transaction((tx) => recordOfflinePayment(tx, { makerspace, customer: customer(name, extra.stateCode), currency: "INR", items: ROOM_HIRE, bookingId: extra.bookingId, method: extra.method ?? "cash", utr: extra.utr, reference: extra.reference, actorUserId: staff[0].id, now: june }));

beforeAll(async () => {
  ({ makerspace } = await createPaymentsMakerspace({ makerChecker: true }));
  staff = await people(2);
});

afterAll(async () => {
  if (makerspace) await removePaymentsMakerspace(makerspace.id, staff.map((person) => person.id));
  await prisma.$disconnect();
});

describe.sequential("offline payments", () => {
  it("waits for a second person, then receipts with a GST tax invoice to the customer", async () => {
    const { payment, settled } = await offline("shaan", { reference: "Book 4/12", bookingId: "booking-placeholder" });
    expect(settled).toBe(false);
    expect(payment).toMatchObject({ status: "AWAITING_CONFIRMATION", bookingId: "booking-placeholder", customerName: "shaan", customerStateCode: "KL" });
    await expect(prisma.$transaction((tx) => confirmOfflinePayment(tx, { makerspace, paymentId: payment.id, actorUserId: staff[0].id, now: june }))).rejects.toThrow(/Someone else/);

    const confirmed = await prisma.$transaction((tx) => confirmOfflinePayment(tx, { makerspace, paymentId: payment.id, actorUserId: staff[1].id, now: june }));
    expect(confirmed).toMatchObject({ status: "PAID", confirmedById: staff[1].id, amountMinor: 118_000 });
    const [document] = await prisma.taxDocument.findMany({ where: { paymentId: payment.id } });
    expect(document).toMatchObject({ kind: "TAX_INVOICE", series: "R", financialYear: "2026-27", number: "KUNJ-2627-00001", totalMinor: 118_000, taxableMinor: 100_000, cgstMinor: 9_000, sgstMinor: 9_000, placeOfSupply: "KL", sac: "997212" });
    expect((document.snapshot as { recipient: { name: string; email: string } }).recipient).toMatchObject({ name: "shaan", email: payment.customerEmail });
  });

  it("refuses a reused UTR, but takes it again after the first is rejected", async () => {
    const first = await offline("abhiram", { method: "upi", utr: "612345678901" });
    await expect(offline("midlaj", { method: "upi", utr: "612345678901" })).rejects.toThrow();
    await prisma.$transaction((tx) => rejectOfflinePayment(tx, { makerspace, paymentId: first.payment.id, actorUserId: staff[1].id, reason: "No such transfer" }));
    const again = await offline("midlaj", { method: "upi", utr: "612345678901" });
    expect(again.payment.status).toBe("AWAITING_CONFIRMATION");
  });

  it("cancels only open payments and refuses an empty charge", async () => {
    const { payment } = await offline("ajzal");
    await prisma.$transaction((tx) => cancelPayment(tx, { makerspace, paymentId: payment.id, actorUserId: staff[0].id }));
    await expect(prisma.$transaction((tx) => cancelPayment(tx, { makerspace, paymentId: payment.id, actorUserId: staff[0].id }))).rejects.toThrow(/Only an open payment/);
    await expect(prisma.$transaction((tx) => createPayment(tx, { makerspace, customer: customer("nobody"), currency: "INR", items: [{ kind: "BOOKING", description: "Free", amountMinor: 0 }], provider: "OFFLINE", status: "PENDING" }))).rejects.toThrow(/Nothing is due/);
  });
});

describe.sequential("refunds and credit notes", () => {
  it("issues a pro-rata credit note and stops at the amount received", async () => {
    const { payment } = await offline("anin", { method: "upi", utr: "699999999999", stateCode: "TN" });
    await prisma.$transaction((tx) => confirmOfflinePayment(tx, { makerspace, paymentId: payment.id, actorUserId: staff[1].id, now: june }));
    const invoice = await prisma.taxDocument.findFirstOrThrow({ where: { paymentId: payment.id, kind: "TAX_INVOICE" } });
    expect(invoice).toMatchObject({ igstMinor: 18_000, cgstMinor: 0, placeOfSupply: "TN" });

    const { refund } = await prisma.$transaction((tx) => createRefund(tx, { makerspace, paymentId: payment.id, amountMinor: 59_000, reason: "Half the time", actorUserId: staff[1].id, now: june }));
    expect(refund.status).toBe("PROCESSED");
    const credit = await prisma.taxDocument.findUniqueOrThrow({ where: { refundId: refund.id } });
    expect(credit).toMatchObject({ kind: "CREDIT_NOTE", series: "C", number: "KUNJ-2627-C00001", totalMinor: 59_000, taxableMinor: 50_000, igstMinor: 9_000 });
    await expect(prisma.$transaction((tx) => createRefund(tx, { makerspace, paymentId: payment.id, amountMinor: 59_001, reason: "Too much", actorUserId: staff[1].id }))).rejects.toThrow(/more than is left/);
  });
});

describe.sequential("immutability", () => {
  it("lets a paid payment gain settlement details but never change its amount, customer or booking", async () => {
    const paid = await prisma.payment.findFirstOrThrow({ where: { makerspaceId: makerspace.id, status: "PAID", bookingId: { not: null } }, include: { documents: true } });
    await prisma.payment.update({ where: { id: paid.id }, data: { settlementId: "setl_1" } });
    await expect(prisma.payment.update({ where: { id: paid.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(prisma.payment.update({ where: { id: paid.id }, data: { customerEmail: "someone-else@example.test" } })).rejects.toThrow();
    await expect(prisma.payment.update({ where: { id: paid.id }, data: { bookingId: "another-booking" } })).rejects.toThrow();
    await expect(prisma.payment.delete({ where: { id: paid.id } })).rejects.toThrow();
    const document = paid.documents[0];
    await expect(prisma.taxDocument.update({ where: { id: document.id }, data: { number: "X-1" } })).rejects.toThrow();
    await expect(prisma.taxDocument.delete({ where: { id: document.id } })).rejects.toThrow();
    await expect(prisma.paymentLine.updateMany({ where: { paymentId: paid.id }, data: { description: "edited" } })).rejects.toThrow();
  });
});

describe.sequential("document numbering", () => {
  it("allocates gapless numbers under concurrency, including the first documents of a new financial year", async () => {
    for (const when of [june, at("2027-05-01T06:00:00Z")]) {
      const payments = await Promise.all(Array.from({ length: 6 }, (_, index) => prisma.$transaction((tx) => createPayment(tx, { makerspace, customer: customer(`burst-${when.getUTCFullYear()}-${index}`), currency: "INR", items: ROOM_HIRE, provider: "OFFLINE", status: "AWAITING_CONFIRMATION", method: "cash", recordedById: staff[0].id }))));
      await Promise.all(payments.map((payment) => prisma.$transaction((tx) => settlePayment(tx, { makerspace, paymentId: payment.id, confirmedById: staff[1].id, now: when }))));
      const year = when === june ? "2026-27" : "2027-28";
      const sequences = (await prisma.taxDocument.findMany({ where: { makerspaceId: makerspace.id, series: "R", financialYear: year }, select: { sequence: true } })).map((doc) => doc.sequence).sort((a, b) => a - b);
      expect(sequences).toEqual(Array.from({ length: sequences.length }, (_, index) => index + 1));
    }
  });
});
