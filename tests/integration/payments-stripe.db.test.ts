import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaymentsMakerspace, customer, ensurePaymentKey, removePaymentsMakerspace, ROOM_HIRE } from "./payments-helpers";

ensurePaymentKey();

const { prisma } = await import("@/lib/db");
const { createPayment } = await import("@/lib/payments/charges");
const { savePaymentKeys, ensurePaymentSettings } = await import("@/lib/payments/config");
const { webhookResponse } = await import("@/lib/payments/webhookRoute");

type Ctx = Awaited<ReturnType<typeof createPaymentsMakerspace>>;
let makerspace: Ctx["makerspace"];
let code: string;
const SECRET = "whsec_test_secret";

/** A Stripe-style signature: t=<unix seconds>,v1=HMAC-SHA256(secret, "<t>.<body>"). */
const signature = (body: string, seconds = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${seconds},v1=${crypto.createHmac("sha256", secret).update(`${seconds}.${body}`).digest("hex")}`;
const session = (type: string, eventId: string, paymentId: string, orderId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id: eventId, type, data: { object: { id: orderId, client_reference_id: paymentId, payment_intent: `pi_${paymentId.slice(-6)}`, amount_total: 118_000, currency: "inr", payment_status: "paid", metadata: { paymentId }, ...extra } } });
const post = (body: string, header: string | null = signature(body), endpoint = code) =>
  webhookResponse("STRIPE", endpoint, new Request(`http://localhost/api/webhooks/stripe/${endpoint}`, { method: "POST", body, headers: header ? { "stripe-signature": header } : {} }));

async function checkout(name: string) {
  const payment = await prisma.$transaction((tx) => createPayment(tx, { makerspace, customer: customer(name), currency: "INR", items: ROOM_HIRE, provider: "STRIPE", status: "PENDING" }));
  const orderId = `cs_test_${payment.id.slice(-10)}`;
  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: orderId } });
  return { payment, orderId };
}

beforeAll(async () => {
  ({ makerspace } = await createPaymentsMakerspace());
  await savePaymentKeys(makerspace.id, { provider: "STRIPE", keyId: "pk_test_key", secret: "sk_test_key", webhookSecret: SECRET, testMode: true });
  code = (await ensurePaymentSettings(makerspace.id)).webhookPublicCode;
});

afterAll(async () => {
  if (makerspace) await removePaymentsMakerspace(makerspace.id);
  await prisma.$disconnect();
});

describe.sequential("Stripe webhooks through the route", () => {
  it("refuses malformed endpoints, oversized bodies, bad and stale signatures", async () => {
    const body = session("checkout.session.completed", "evt_x", "x", "cs_x");
    expect((await post(body, signature(body), "short")).status).toBe(404);
    const huge = "x".repeat(256 * 1024 + 1);
    expect((await post(huge, signature(huge))).status).toBe(413);
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, signature(body, undefined, "whsec_wrong"))).status).toBe(401);
    expect((await post(body, signature(body, Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
  });

  it("settles a paid checkout once and issues the tax invoice", async () => {
    const { payment, orderId } = await checkout("anin");
    const body = session("checkout.session.completed", "evt_paid_1", payment.id, orderId);
    const first = await post(body);
    expect([first.status, await first.text()]).toEqual([200, "OK"]);
    const again = await post(body);
    expect([again.status, await again.text()]).toEqual([200, "Duplicate"]);

    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { documents: true } });
    expect(paid).toMatchObject({ status: "PAID", amountMinor: 118_000, flaggedAt: null });
    expect(paid.documents.map((document) => document.kind)).toEqual(["TAX_INVOICE"]);
  });

  it("waits for a delayed method, then settles when Stripe confirms it", async () => {
    const { payment, orderId } = await checkout("ajzal");
    const pending = await post(session("checkout.session.completed", "evt_async_1", payment.id, orderId, { payment_status: "unpaid" }));
    expect([pending.status, await pending.text()]).toEqual([200, "Ignored"]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");

    expect((await post(session("checkout.session.async_payment_succeeded", "evt_async_2", payment.id, orderId))).status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID");
  });

  it("fails an expired checkout so the member can try again", async () => {
    const { payment, orderId } = await checkout("midlaj");
    expect((await post(session("checkout.session.expired", "evt_expired", payment.id, orderId, { payment_status: "unpaid" }))).status).toBe(200);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "FAILED", note: "Checkout expired" });
  });
});
