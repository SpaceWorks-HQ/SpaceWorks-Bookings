import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { BookingError } from "@/lib/bookings/errors";
import { expireHolds } from "@/lib/bookings/expiry";
import { addSpace, at, eventsOf, hold, HOUR, NOW, rowsOf, setupMakerspace, type Fixture } from "./bookings-helpers";

let fixture: Fixture;

describe.sequential("racing holds", () => {
  beforeAll(async () => {
    fixture = await setupMakerspace({ holdMinutes: 15 });
  });
  afterAll(async () => {
    await fixture.cleanup();
  });

  it("lets exactly one of many parallel holds win a single unit", { timeout: 120_000 }, async () => {
    const space = await addSpace(fixture.makerspaceId);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => hold(fixture, space.id, [24, 26])));
    const won = results.filter((result) => result.status === "fulfilled");
    expect(won).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(BookingError);
        expect(["UNAVAILABLE", "SLOT_TAKEN"]).toContain((result.reason as BookingError).code);
      }
    }
    expect(await prisma.bookingOccurrence.count({ where: { spaceId: space.id, blocking: true } })).toBe(1);
  });

  it("hands out each of N units once, lowest first", { timeout: 120_000 }, async () => {
    const desks = await addSpace(fixture.makerspaceId, { name: "Hot desks", kind: "DESK", units: 3 });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => hold(fixture, desks.id, [24, 26])));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    const units = (await prisma.bookingOccurrence.findMany({ where: { spaceId: desks.id, blocking: true }, select: { unit: true } })).map((row) => row.unit).sort();
    expect(units).toEqual([0, 1, 2]);
  });

  it("books several units at once and refuses more than are free", async () => {
    const desks = await addSpace(fixture.makerspaceId, { name: "Desks", kind: "DESK", units: 4 });
    const first = await hold(fixture, desks.id, [30, 32], { quantity: 3 });
    expect(first.occurrences.map((row) => row.unit)).toEqual([0, 1, 2]);
    await expect(hold(fixture, desks.id, [31, 33], { quantity: 2 })).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Only 1 free at that time." });
    await expect(hold(fixture, desks.id, [31, 33], { quantity: 5 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await hold(fixture, desks.id, [31, 33], { quantity: 1 })).occurrences[0].unit).toBe(3);
  });

  it("releases expired holds for the space before taking a new one", async () => {
    const space = await addSpace(fixture.makerspaceId);
    const stale = await hold(fixture, space.id, [40, 41]);
    // Sixteen minutes later the hold has run out: a new customer gets the slot, the old hold is expired.
    const later = new Date(NOW.getTime() + 16 * 60_000);
    const fresh = await hold(fixture, space.id, [40, 41], { now: later });
    expect(fresh.occurrences).toHaveLength(1);
    const old = await prisma.booking.findUniqueOrThrow({ where: { id: stale.bookingId } });
    expect(old.status).toBe("EXPIRED");
    expect((await rowsOf(stale.bookingId)).every((row) => row.status === "CANCELLED" && !row.blocking)).toBe(true);
    expect(await eventsOf(stale.bookingId)).toEqual(["held", "expired"]);
  });

  it("expires holds in the beat job and is idempotent", async () => {
    const space = await addSpace(fixture.makerspaceId);
    const held = await hold(fixture, space.id, [50, 51]);
    expect(await expireHolds(new Date(NOW.getTime() + 10 * 60_000))).toBe(0);
    expect(await expireHolds(new Date(NOW.getTime() + HOUR))).toBeGreaterThanOrEqual(1);
    expect(await expireHolds(new Date(NOW.getTime() + HOUR))).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.bookingId } })).status).toBe("EXPIRED");
    // The slot is free again.
    await expect(hold(fixture, space.id, [50, 51], { now: at(1) })).resolves.toBeTruthy();
  });
});
