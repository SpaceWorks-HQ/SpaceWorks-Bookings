import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publicUrl", async (importOriginal) => ({ ...(await importOriginal<object>()), getRequestOrigin: async () => "http://127.0.0.1:3011" }));

const { setupMoney, moneyBooking, prisma, NOW } = await import("./money-helpers");
const { GATEWAYS } = await import("@/lib/payments/config");
const { startBookingPayment } = await import("@/lib/bookings/money/start");
const { cancelBooking } = await import("@/lib/bookings/cancel");
type Fixture = Awaited<ReturnType<typeof setupMoney>>;
const fixtures: Fixture[] = [];
async function fixture() {
  const f = await setupMoney({ chargeMode: "PAY_NOW" }, { provider: "STRIPE" });
  fixtures.push(f);
  return f;
}
const start = (f: Fixture, bookingId: string) => startBookingPayment({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, returnPath: "/x", now: NOW });
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const f of fixtures) await f.cleanup();
  await prisma.$disconnect();
});

describe("checkout reservations", () => {
  it("keeps one open attempt when several requests start together", async () => {
    const f = await fixture();
    const bookingId = await moneyBooking(f, [30, 32]);
    vi.spyOn(GATEWAYS.STRIPE, "createCheckout").mockImplementation(async (_credentials, request) => ({ kind: "redirect", orderId: `cs_${request.paymentId}`, url: "https://checkout.stripe.com/test" }));
    vi.spyOn(GATEWAYS.STRIPE, "expireCheckout").mockResolvedValue();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => start(f, bookingId)));
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const payments = await prisma.payment.findMany({ where: { bookingId } });
    expect(payments).toHaveLength(5);
    expect(payments.filter((payment) => payment.status === "PENDING")).toHaveLength(1);
    expect(payments.filter((payment) => payment.status === "CANCELLED")).toHaveLength(4);
  });

  it("expires a delayed provider order after a newer attempt supersedes its reservation", async () => {
    const f = await fixture();
    const bookingId = await moneyBooking(f, [34, 36]);
    const entered = signal();
    const release = signal();
    let firstId = "";
    vi.spyOn(GATEWAYS.STRIPE, "createCheckout").mockImplementation(async (_credentials, request) => {
      if (!firstId) { firstId = request.paymentId; entered.resolve(); await release.promise; }
      return { kind: "redirect", orderId: `cs_${request.paymentId}`, url: "https://checkout.stripe.com/test" };
    });
    const expire = vi.spyOn(GATEWAYS.STRIPE, "expireCheckout").mockResolvedValue();
    const first = start(f, bookingId);
    const rejected = expect(first).rejects.toThrow(/attempt was closed/);
    try {
      await entered.promise;
      const second = await start(f, bookingId);
      expect(second.paymentId).not.toBe(firstId);
    } finally { release.resolve(); }
    await rejected;
    expect(expire).toHaveBeenCalledWith(expect.anything(), `cs_${firstId}`);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: firstId } })).toMatchObject({ status: "CANCELLED", gatewayOrderId: `cs_${firstId}` });
  });

  it("closes a delayed order if the customer cancels while the provider is creating it", async () => {
    const f = await fixture();
    const bookingId = await moneyBooking(f, [38, 40]);
    const entered = signal();
    const release = signal();
    vi.spyOn(GATEWAYS.STRIPE, "createCheckout").mockImplementation(async (_credentials, request) => {
      entered.resolve(); await release.promise;
      return { kind: "redirect", orderId: `cs_${request.paymentId}`, url: "https://checkout.stripe.com/test" };
    });
    const expire = vi.spyOn(GATEWAYS.STRIPE, "expireCheckout").mockResolvedValue();
    const attempt = start(f, bookingId);
    const rejected = expect(attempt).rejects.toThrow(/attempt was closed/);
    try {
      await entered.promise;
      await cancelBooking({ makerspaceId: f.makerspaceId, bookingId, actor: f.customer, kind: "CUSTOMER", now: NOW });
    } finally { release.resolve(); }
    await rejected;
    expect(expire).toHaveBeenCalledOnce();
    expect(await prisma.payment.count({ where: { bookingId, status: "PENDING" } })).toBe(0);
  });
});
