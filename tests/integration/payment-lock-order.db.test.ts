import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { moneyBooking, prisma, setupMoney, type MoneyFixture } from "./money-helpers";
import { createPayment } from "@/lib/payments/charges";
import { failPayment } from "@/lib/payments/settle";
import { lockBooking } from "@/lib/bookings/db";

let fixture: MoneyFixture;
afterAll(async () => { if (fixture) await fixture.cleanup(); await prisma.$disconnect(); });

it("waits for the booking before taking a payment lock that would deadlock its status trigger", async () => {
  fixture = await setupMoney({ chargeMode: "PAY_LATER" });
  const bookingId = await moneyBooking(fixture, [30, 32]);
  const payment = await prisma.$transaction((tx) => createPayment(tx, { makerspace: fixture.payments, customer: { name: "Asha", email: "asha@example.test" }, currency: "INR", provider: "RAZORPAY", status: "PENDING", bookingId, items: [{ kind: "BOOKING", description: "Booking", amountMinor: 1000 }] }));
  let release!: () => void;
  const released = new Promise<void>((done) => { release = done; });
  let locked!: () => void;
  const bookingLocked = new Promise<void>((done) => { locked = done; });
  const holder = prisma.$transaction(async (tx) => {
    await lockBooking(tx, fixture.makerspaceId, bookingId);
    locked();
    await released;
  }, { timeout: 20_000 });
  await bookingLocked;
  const applicationName = `booking-lock-${randomUUID()}`;
  const contender = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('application_name', ${applicationName}, true)`;
    return failPayment(tx, { makerspace: fixture.payments, paymentId: payment.id, reason: "Provider refused" });
  }, { timeout: 20_000 });
  // Observe the real database wait instead of depending on process timing or a mocked lock implementation.
  try {
    const deadline = Date.now() + 10_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE application_name = ${applicationName}`;
      if (rows.some((row) => row.waiting)) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(waiting).toBe(true);
    // The waiting mutation must leave the payment available to the booking-lock owner.
    await prisma.$transaction((tx) => tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE NOWAIT`);
  } finally { release(); await holder; }
  expect(await contender).toMatchObject({ status: "FAILED" });
});
