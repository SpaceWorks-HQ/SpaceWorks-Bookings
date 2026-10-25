import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { localParts } from "@/lib/time/zoned";
import { seedBookingCatalogue } from "../../scripts/seed/booking-catalogue.mjs";
import { seedBookings } from "../../scripts/seed/bookings.mjs";
import { NOW, at, setupMakerspace, type Fixture } from "./bookings-helpers";

let fixture: Fixture;
let owner: { id: string };
let front: { id: string };

async function seed(now = NOW) {
  const spaces = await seedBookingCatalogue(prisma, fixture.makerspaceId);
  await seedBookings(prisma, { makerspaceId: fixture.makerspaceId, spaces, owner, front, customer: fixture.customerUser, now });
}

async function snapshot() {
  const makerspaceId = fixture.makerspaceId;
  return {
    bookings: await prisma.booking.findMany({ where: { makerspaceId }, orderBy: { reference: "asc" }, include: { occurrences: true } }),
    events: await prisma.bookingEvent.count({ where: { makerspaceId } }),
    spaces: await prisma.space.count({ where: { makerspaceId } }),
    hours: await prisma.openingHours.count({ where: { makerspaceId } }),
    extras: await prisma.addOn.count({ where: { makerspaceId } }),
    peaks: await prisma.peakRule.count({ where: { makerspaceId } }),
    refunds: await prisma.refundTier.count({ where: { makerspaceId } }),
    members: await prisma.makerspaceMember.count({ where: { makerspaceId } }),
  };
}

describe.sequential("Phase 1 demo seed", () => {
  beforeAll(async () => {
    fixture = await setupMakerspace();
    owner = { id: fixture.owner.userId };
    front = { id: (await fixture.staff("FRONT_DESK")).userId };
  });
  afterAll(async () => { await fixture.cleanup(); });

  it("seeds twice without duplicate rows, tokens or append-only events", async () => {
    await seed();
    const first = await snapshot();
    await seed();
    const second = await snapshot();
    expect(second).toMatchObject({ events: 8, spaces: 4, hours: 6, extras: 2, peaks: 1, refunds: 3, members: 3 });
    expect(second.bookings).toHaveLength(8);
    expect(second.bookings.map(({ id, reference, manageTokenHash }) => ({ id, reference, manageTokenHash })))
      .toEqual(first.bookings.map(({ id, reference, manageTokenHash }) => ({ id, reference, manageTokenHash })));
    expect(second.bookings.map((booking) => booking.occurrences.map((row) => row.id)))
      .toEqual(first.bookings.map((booking) => booking.occurrences.map((row) => row.id)));
    const hours = await prisma.openingHours.findMany({ where: { makerspaceId: fixture.makerspaceId }, orderBy: { weekday: "asc" } });
    expect(hours.map(({ weekday, openMinute, closeMinute }) => ({ weekday, openMinute, closeMinute })))
      .toEqual([1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openMinute: 540, closeMinute: 1260 })));
    expect(second.bookings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: "BK-DE0001", status: "CONFIRMED", totalMinor: 0 }),
      expect.objectContaining({ reference: "BK-DE0002", status: "REQUESTED", rateKind: "MEMBER" }),
      expect.objectContaining({ reference: "BK-DE0003", status: "HELD", awaitingPayment: true }),
      expect.objectContaining({ reference: "BK-DE0004", status: "CONFIRMED", payLater: true, paymentDueAt: expect.any(Date) }),
      expect.objectContaining({ reference: "BK-DE0005", status: "CANCELLED" }),
      expect.objectContaining({ reference: "BK-DE0006", occurrences: [expect.objectContaining({ status: "CHECKED_IN", checkedInById: front.id })] }),
    ]));
    for (const booking of second.bookings) {
      expect(booking.occurrences).toHaveLength(1);
      expect(booking.occurrences[0].priceMinor).toBe(booking.totalMinor);
      expect(booking.occurrences[0].blocking).toBe(booking.status !== "CANCELLED");
    }
  });

  it("refreshes dates on a later seed and keeps Today's arrival checkable even late on Sunday", async () => {
    // Sunday 13 January, 23:30 IST: ordinary opening hours have no available starts.
    const sunday = at(6 * 24 + 18);
    await seed(sunday);
    const rows = await snapshot();
    expect(rows.bookings).toHaveLength(8);
    expect(rows.events).toBe(8);
    const arrival = rows.bookings.find((booking) => booking.reference === "BK-DE0007")!;
    const occurrence = arrival.occurrences[0];
    expect(localParts(occurrence.startsAt, "Asia/Kolkata").date).toEqual(localParts(sunday, "Asia/Kolkata").date);
    expect(occurrence.endsAt.getTime()).toBeGreaterThan(sunday.getTime());
    expect(occurrence.startsAt.getTime() - sunday.getTime()).toBeLessThan(86_400_000);
    expect(arrival).toMatchObject({ status: "CONFIRMED", source: "STAFF", overrideReason: expect.any(String) });
    expect(occurrence.status).toBe("SCHEDULED");
  });
});
