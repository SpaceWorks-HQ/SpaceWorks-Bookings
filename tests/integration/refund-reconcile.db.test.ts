import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { at, createPaymentsMakerspace, customer, ensurePaymentKey, people, removePaymentsMakerspace, ROOM_HIRE } from "./payments-helpers";

ensurePaymentKey();

const { prisma } = await import("@/lib/db");
const { createPayment } = await import("@/lib/payments/charges");
const { savePaymentKeys } = await import("@/lib/payments/config");
const { settlePayment } = await import("@/lib/payments/settle");
const { createRefund } = await import("@/lib/payments/refunds");
const { reconcileGatewayRefunds } = await import("@/lib/payments/reconcileRefunds");

type Ctx = Awaited<ReturnType<typeof createPaymentsMakerspace>>;
let makerspace: Ctx["makerspace"];
let staff: Array<{ id: string }>;
const paidOn = at("2026-06-15T06:00:00Z");
const refundedOn = at("2026-06-16T06:00:00Z");
const later = new Date(refundedOn.getTime() + 15 * 60_000);

/** A Razorpay payment with a refund still PENDING, as if the provider's answer never arrived. */
async function pendingRefund(name: string, paymentRef: string) {
  const payment = await prisma.$transaction((tx) => createPayment(tx, { makerspace, customer: customer(name), currency: "INR", items: ROOM_HIRE, provider: "RAZORPAY", status: "PENDING" }));
  await prisma.$transaction((tx) => settlePayment(tx, { makerspace, paymentId: payment.id, capture: { gatewayPaymentId: paymentRef, amountMinor: 118_000, currency: "INR", method: "upi" }, now: paidOn }));
  const { refund } = await prisma.$transaction((tx) => createRefund(tx, { makerspace, paymentId: payment.id, amountMinor: 118_000, reason: "Cancelled", actorUserId: staff[0].id, now: refundedOn }));
  await prisma.$executeRaw`UPDATE "Refund" SET "createdAt" = ${refundedOn} WHERE "id" = ${refund.id}`;
  return refund;
}

/** Razorpay's refunds list for a payment, answering with whatever `items` the test sets up. */
function stubRazorpay(items: (url: string) => Array<Record<string, unknown>>) {
  const fetchStub = vi.fn(async (url: string) => new Response(JSON.stringify({ items: items(url) }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

beforeAll(async () => {
  ({ makerspace } = await createPaymentsMakerspace());
  staff = await people(1);
  await savePaymentKeys(makerspace.id, { provider: "RAZORPAY", keyId: "rzp_test_key", secret: "secret_key", webhookSecret: "hook_secret", testMode: true });
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  if (makerspace) await removePaymentsMakerspace(makerspace.id, staff?.map((person) => person.id) ?? []);
  await prisma.$disconnect();
});

describe.sequential("pending refund follow-up", () => {
  it("settles a refund the provider processed, found by our refund id, and issues the credit note", async () => {
    const refund = await pendingRefund("gauri", "pay_follow_1");
    const fetchStub = stubRazorpay((url) => url.includes("/payments/pay_follow_1/refunds") ? [{ id: "rfnd_follow_1", status: "processed", notes: { refundId: refund.id } }] : []);
    const result = await reconcileGatewayRefunds(later);
    expect(result.settled).toBeGreaterThanOrEqual(1);
    expect(fetchStub).toHaveBeenCalled();
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "PROCESSED", gatewayRefundId: "rfnd_follow_1" });
    expect(await prisma.taxDocument.count({ where: { refundId: refund.id, kind: "CREDIT_NOTE" } })).toBe(1);
  });

  it("leaves a refund pending while the provider is still working on it or can't find it, and fails it only on the provider's word", async () => {
    const refund = await pendingRefund("hiba", "pay_follow_2");
    stubRazorpay(() => []);
    await reconcileGatewayRefunds(later);
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "PENDING", lastCheckedAt: later });

    stubRazorpay(() => [{ id: "rfnd_follow_2", status: "failed", notes: { refundId: refund.id } }]);
    await reconcileGatewayRefunds(new Date(later.getTime() + 60_000));
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).toMatchObject({ status: "FAILED" });
  });

  it("does not ask about refunds younger than ten minutes", async () => {
    const refund = await pendingRefund("irfan", "pay_follow_3");
    const fetchStub = stubRazorpay(() => [{ id: "rfnd_follow_3", status: "processed", notes: { refundId: refund.id } }]);
    await reconcileGatewayRefunds(new Date(refundedOn.getTime() + 5 * 60_000));
    expect(fetchStub).not.toHaveBeenCalled();
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("PENDING");
  });
});
