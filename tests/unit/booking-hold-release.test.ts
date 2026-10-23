import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ lock: vi.fn(), update: vi.fn(), rows: vi.fn(), event: vi.fn(), charge: vi.fn() }));
vi.mock("@/lib/bookings/db", () => ({
  defaultDb: () => ({}), lockBooking: mocks.lock,
  withTx: (tx: unknown, work: (tx: unknown) => unknown) => work(tx),
}));
vi.mock("@/lib/bookings/charge", () => ({ recomputeCharge: mocks.charge }));
import { releaseHold } from "@/lib/bookings/expiry";
import { hashToken } from "@/lib/bookings/tokens";

const manageToken = "private-hold-token";
const booking = { id: "held", status: "HELD", submittedAt: null, customerUserId: null, manageTokenHash: hashToken(manageToken) };
const input = { makerspaceId: "tenant", bookingId: "held", actor: { kind: "CUSTOMER", userId: null, manageToken } } as const;
const tx = { booking: { updateMany: mocks.update }, bookingOccurrence: { updateMany: mocks.rows }, bookingEvent: { create: mocks.event } } as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockResolvedValue(booking);
  mocks.update.mockResolvedValue({ count: 1 });
});

describe("checkout hold release", () => {
  it("locks the tenant booking, clears blocking through the status helper and records the customer event", async () => {
    expect(await releaseHold(input, tx)).toEqual({ released: true });
    expect(mocks.lock).toHaveBeenCalledWith(tx, "tenant", "held");
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "held", status: "HELD" }, data: { status: "EXPIRED", expiredAt: expect.any(Date) } });
    expect(mocks.rows).toHaveBeenCalledWith({ where: { bookingId: "held", status: "SCHEDULED" }, data: {
      status: "CANCELLED", blocking: false, cancelledAt: expect.any(Date), cancelKind: "CUSTOMER", sequence: { increment: 1 },
    } });
    expect(mocks.charge).toHaveBeenCalledWith(tx, "held");
    expect(mocks.event).toHaveBeenCalledWith({ data: {
      makerspaceId: "tenant", bookingId: "held", occurrenceId: null, kind: "expired", actorKind: "CUSTOMER", actorUserId: null,
      data: { from: "HELD", reason: "released" },
    } });
    mocks.lock.mockResolvedValue({ ...booking, status: "EXPIRED" });
    expect(await releaseHold(input, tx)).toEqual({ released: false });
    expect(mocks.update).toHaveBeenCalledOnce(); expect(mocks.event).toHaveBeenCalledOnce();
  });
  it.each(["REQUESTED", "CONFIRMED", "CANCELLED", "DECLINED", "EXPIRED"])("leaves a %s booking untouched", async (status) => {
    mocks.lock.mockResolvedValue({ ...booking, status });
    expect(await releaseHold(input, tx)).toEqual({ released: false });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.event).not.toHaveBeenCalled();
  });
  it("preserves a submitted HELD booking awaiting payment", async () => {
    mocks.lock.mockResolvedValue({ ...booking, submittedAt: new Date(), awaitingPayment: true });
    expect(await releaseHold(input, tx)).toEqual({ released: false });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.event).not.toHaveBeenCalled();
  });
  it("checks ownership again under the lock before changing anything", async () => {
    mocks.lock.mockResolvedValue({ ...booking, manageTokenHash: hashToken("rotated") });
    await expect(releaseHold(input, tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.event).not.toHaveBeenCalled();
  });
});
