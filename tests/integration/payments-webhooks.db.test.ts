import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, createPaymentsMakerspace, customer, ensurePaymentKey, people, removePaymentsMakerspace, ROOM_HIRE } from "./payments-helpers";

ensurePaymentKey();

const { prisma } = await import("@/lib/db");
const { createPayment } = await import("@/lib/payments/charges");
const { savePaymentKeys, ensurePaymentSettings } = await import("@/lib/payments/config");
const { handleWebhook } = await import("@/lib/payments/webhooks");
const { releaseHeldDocument } = await import("@/lib/payments/settle");

type Ctx = Awaited<ReturnType<typeof createPaymentsMakerspace>>;
let makerspace: Ctx["makerspace"];
let code: string;
let reviewer: { id: string };
const now = at("2026-07-01T06:00:00Z");

const sign = (body: string) => crypto.createHmac("sha256", "hook_secret").update(body).digest("hex");
const captured = (paymentId: string, orderId: string, amount: number) =>
  JSON.stringify({ created_at: Math.floor(Date.now() / 1000), event: "payment.captured", payload: { payment: { entity: { id: `pay_${paymentId.slice(-6)}`, order_id: orderId, amount, currency: "INR", method: "upi", notes: { paymentId } } } } });
const deliver = (body: string, eventId: string, signature = sign(body)) =>
  handleWebhook("RAZORPAY", code, body, new Headers({ "x-razorpay-signature": signature, "x-razorpay-event-id": eventId }));

async function gatewayPayment(name: string) {
  const payment = await prisma.$transaction((tx) => createPayment(tx, { makerspace, customer: customer(name), currency: "INR", items: ROOM_HIRE, provider: "RAZORPAY", status: "PENDING" }));
  const orderId = `order_${payment.id.slice(-8)}`;
  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: orderId } });
  return { payment, orderId };
}

beforeAll(async () => {
  ({ makerspace } = await createPaymentsMakerspace());
  await savePaymentKeys(makerspace.id, { provider: "RAZORPAY", keyId: "rzp_test_key", secret: "secret_key", webhookSecret: "hook_secret", testMode: true });
  code = (await ensurePaymentSettings(makerspace.id)).webhookPublicCode;
  [reviewer] = await people(1);
});

afterAll(async () => {
  if (makerspace) await removePaymentsMakerspace(makerspace.id, reviewer ? [reviewer.id] : []);
  await prisma.$disconnect();
});

describe.sequential("gateway webhooks", () => {
  it("refuses unknown endpoints and bad signatures", async () => {
    const body = captured("x", "order_x", 1);
    expect((await handleWebhook("RAZORPAY", "nope-nope-nope-nope", body, new Headers())).status).toBe(404);
    expect((await handleWebhook("STRIPE", code, body, new Headers())).status).toBe(404);
    expect((await deliver(body, "evt_bad", "0".repeat(64))).status).toBe(401);
  });

  it("settles a capture once, however many times it is delivered", async () => {
    const { payment, orderId } = await gatewayPayment("samad");
    const body = captured(payment.id, orderId, 118_000);
    expect(await deliver(body, "evt_1")).toEqual({ status: 200, body: "OK" });
    expect(await deliver(body, "evt_1")).toEqual({ status: 200, body: "Duplicate" });
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { documents: true } });
    expect(paid).toMatchObject({ status: "PAID", method: "upi", flaggedAt: null, documentHeld: false });
    expect(paid.documents).toHaveLength(1);
    // A different event for the same capture settles nothing twice.
    expect((await deliver(body, "evt_1b")).status).toBe(200);
    expect(await prisma.taxDocument.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("records a mismatched amount as paid but holds the document until a manager releases it", async () => {
    const { payment, orderId } = await gatewayPayment("ideologist");
    expect((await deliver(captured(payment.id, orderId, 100_000), "evt_2")).status).toBe(200);
    const held = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(held).toMatchObject({ status: "PAID", documentHeld: true, capturedMinor: 100_000 });
    expect(held.flagReason).toMatch(/differs/);
    expect(await prisma.taxDocument.count({ where: { paymentId: payment.id } })).toBe(0);

    const document = await prisma.$transaction((tx) => releaseHeldDocument(tx, { makerspace, paymentId: payment.id, actorUserId: reviewer.id }));
    expect(document.totalMinor).toBe(100_000);
    expect(document.cgstMinor + document.sgstMinor + document.taxableMinor).toBe(100_000);
  });

  it("receipts and flags a capture that arrives after its attempt was closed", async () => {
    const { payment, orderId } = await gatewayPayment("tinker");
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "CANCELLED" } });
    expect((await deliver(captured(payment.id, orderId, 118_000), "evt_3")).status).toBe(200);
    const late = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(late.status).toBe("PAID");
    expect(late.flagReason).toMatch(/after this attempt was closed/);
    expect(await prisma.taxDocument.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it("fails an open attempt and acknowledges unknown events", async () => {
    const { payment, orderId } = await gatewayPayment("failure");
    const failed = JSON.stringify({ created_at: Math.floor(Date.now() / 1000), event: "payment.failed", payload: { payment: { entity: { id: "pay_f", order_id: orderId, notes: { paymentId: payment.id }, error_description: "Bank declined" } } } });
    expect((await deliver(failed, "evt_5")).status).toBe(200);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "FAILED", note: "Bank declined" });
    expect(await deliver(JSON.stringify({ created_at: Math.floor(Date.now() / 1000), event: "order.paid" }), "evt_6")).toEqual({ status: 200, body: "Ignored" });
  });
});
