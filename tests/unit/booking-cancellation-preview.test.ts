import { describe, expect, it } from "vitest";
import type { BookingOccurrence } from "@prisma/client";
import { cancellationPreview } from "@/lib/bookings/cancellationPreview";

const now = new Date("2026-11-01T10:00Z");
const booking = { status: "CONFIRMED" as const, policySnapshot: { refundTiers: [{ minHoursBefore: 0, refundBps: 5000 }], depositRefundable: true, chargeLateCancelWhenUnpaid: false, noShowCharge: "FULL" }, depositMinor: 0, paidMinor: 20000, refundedMinor: 0 };
const rows = [0, 1].map((slotIndex) => ({ id: `slot-${slotIndex}`, slotIndex, unit: 0, status: "SCHEDULED", priceMinor: 10000, keptFeeMinor: 0, noShowAt: null,
  startsAt: new Date(`2026-11-0${slotIndex + 2}T10:00Z`), policyAnchorAt: new Date(`2026-11-0${slotIndex + 2}T10:00Z`) })) as BookingOccurrence[];

describe("customer cancellation estimates", () => {
  it("applies the policy to all, one, or this and following times", () => {
    expect(cancellationPreview(booking, rows, { type: "ALL" }, now, 0)).toMatchObject({ allowed: true, keptMinor: 10000, chargeMinor: 10000, refundMinor: 10000, balanceMinor: 0 });
    expect(cancellationPreview(booking, rows, { type: "OCCURRENCE", occurrenceId: "slot-0" }, now, 0)).toMatchObject({ keptMinor: 5000, chargeMinor: 15000, refundMinor: 5000 });
    expect(cancellationPreview(booking, rows, { type: "FOLLOWING", occurrenceId: "slot-0" }, now, 0)).toMatchObject({ chargeMinor: 10000 });
  });
  it("keeps a non-refundable deposit floor and voids unpaid fees by default", () => {
    expect(cancellationPreview({ ...booking, depositMinor: 15000, policySnapshot: { ...booking.policySnapshot, depositRefundable: false } }, rows, { type: "ALL" }, now, 0))
      .toMatchObject({ keptMinor: 15000, refundMinor: 5000 });
    expect(cancellationPreview({ ...booking, paidMinor: 0 }, rows, { type: "ALL" }, now, 0)).toMatchObject({ keptMinor: 0, balanceMinor: 0 });
  });
  it("uses the earliest policy anchor and honours each target's cutoff", () => {
    const moved = [{ ...rows[0], policyAnchorAt: new Date("2026-10-31T10:00Z") }];
    expect(cancellationPreview(booking, moved, { type: "ALL" }, now, 0)).toMatchObject({ keptMinor: 10000 });
    expect(cancellationPreview(booking, rows, { type: "ALL" }, now, 25).allowed).toBe(false);
    expect(cancellationPreview(booking, rows, { type: "OCCURRENCE", occurrenceId: "slot-1" }, now, 25).allowed).toBe(true);
  });
});
