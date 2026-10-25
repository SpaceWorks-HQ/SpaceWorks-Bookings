import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isExclusionViolation, mapSlotTaken } from "@/lib/bookings/errors";
import { addSpace, at, setupMakerspace, type Fixture } from "./bookings-helpers";

const run = promisify(execFile);
let fixture: Fixture;
let spaceId: string;

async function rawBooking(reference: string) {
  return prisma.booking.create({ data: { makerspaceId: fixture.makerspaceId, spaceId, reference, status: "HELD", source: "PUBLIC", contactName: "Raw", contactEmail: "raw@example.test", currency: "INR", holdExpiresAt: at(1), manageTokenHash: `hash-${reference}-${fixture.suffix}` } });
}

function rawRow(bookingId: string, hours: [number, number], over: Record<string, unknown> = {}) {
  return { makerspaceId: fixture.makerspaceId, bookingId, spaceId, slotIndex: 0, unit: 0, startsAt: at(hours[0]), endsAt: at(hours[1]), blockStart: at(hours[0]), blockEnd: at(hours[1]), blocking: true, policyAnchorAt: at(hours[0]), ...over };
}

describe.sequential("bookings schema", () => {
  beforeAll(async () => {
    fixture = await setupMakerspace();
    spaceId = (await addSpace(fixture.makerspaceId)).id;
  });
  afterAll(async () => {
    await fixture.cleanup();
  });

  it("makes overlapping blocking occurrences of one unit impossible", async () => {
    const first = await rawBooking("BK-AAAAA1");
    const second = await rawBooking("BK-AAAAA2");
    await prisma.bookingOccurrence.create({ data: rawRow(first.id, [10, 12]) });
    const clash = prisma.bookingOccurrence.create({ data: rawRow(second.id, [11, 13]) });
    await expect(clash).rejects.toSatisfy(isExclusionViolation);
    // Back to back, another unit, or not blocking: all fine.
    await prisma.bookingOccurrence.create({ data: rawRow(second.id, [12, 13]) });
    await prisma.bookingOccurrence.create({ data: rawRow(second.id, [10, 12], { unit: 1, slotIndex: 1 }) });
    await prisma.bookingOccurrence.create({ data: rawRow(second.id, [10, 12], { blocking: false, slotIndex: 2 }) });
  });

  it("maps a race lost at the database to SLOT_TAKEN", async () => {
    const [a, b] = [await rawBooking("BK-AAAAA3"), await rawBooking("BK-AAAAA4")];
    const insert = (bookingId: string) =>
      mapSlotTaken(() =>
        prisma.$transaction(async (tx) => {
          await tx.bookingOccurrence.create({ data: rawRow(bookingId, [20, 22]) });
          await new Promise((resolve) => setTimeout(resolve, 200));
        }),
      );
    const results = await Promise.allSettled([insert(a.id), insert(b.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "SLOT_TAKEN", message: "That time was just taken." });
  });

  it("only lets scheduled or checked-in rows block", async () => {
    const booking = await rawBooking("BK-AAAAA5");
    await expect(prisma.bookingOccurrence.create({ data: rawRow(booking.id, [30, 31], { status: "CANCELLED" }) })).rejects.toThrow();
    await expect(prisma.bookingOccurrence.create({ data: rawRow(booking.id, [30, 31], { status: "CHECKED_IN" }) })).resolves.toBeTruthy();
  });

  it("rejects bad times, money and references", async () => {
    const booking = await rawBooking("BK-AAAAA6");
    await expect(prisma.bookingOccurrence.create({ data: rawRow(booking.id, [40, 40]) })).rejects.toThrow();
    await expect(prisma.bookingOccurrence.create({ data: rawRow(booking.id, [41, 42], { priceMinor: -1 }) })).rejects.toThrow();
    await expect(prisma.booking.update({ where: { id: booking.id }, data: { totalMinor: -5 } })).rejects.toThrow();
    await expect(prisma.booking.update({ where: { id: booking.id }, data: { depositMinor: 10, totalMinor: 5 } })).rejects.toThrow();
    await expect(rawBooking("BK-IIIII1")).rejects.toThrow();
    await expect(prisma.booking.update({ where: { id: booking.id }, data: { contactEmail: "Mixed@Example.test" } })).rejects.toThrow();
  });

  it("keeps the timeline append-only", async () => {
    const booking = await rawBooking("BK-AAAAA7");
    const event = await prisma.bookingEvent.create({ data: { makerspaceId: fixture.makerspaceId, bookingId: booking.id, kind: "held", actorKind: "SYSTEM" } });
    await expect(prisma.bookingEvent.update({ where: { id: event.id }, data: { kind: "changed" } })).rejects.toThrow(/append-only/);
    await expect(prisma.bookingEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });

  it("moves occurrences with their booking when staff change its space", async () => {
    const other = await addSpace(fixture.makerspaceId, { name: "Studio B" });
    const booking = await rawBooking("BK-AAAAA8");
    await prisma.bookingOccurrence.create({ data: rawRow(booking.id, [50, 51], { blocking: false }) });
    await prisma.booking.update({ where: { id: booking.id }, data: { spaceId: other.id } });
    expect((await prisma.bookingOccurrence.findFirstOrThrow({ where: { bookingId: booking.id } })).spaceId).toBe(other.id);
  });

  it("refuses a space from another makerspace", async () => {
    const stranger = await setupMakerspace();
    try {
      const theirs = await addSpace(stranger.makerspaceId);
      await expect(prisma.booking.create({ data: { makerspaceId: fixture.makerspaceId, spaceId: theirs.id, reference: "BK-AAAAA9", status: "HELD", source: "PUBLIC", contactName: "X", contactEmail: "x@example.test", currency: "INR", holdExpiresAt: at(1), manageTokenHash: `x-${fixture.suffix}` } })).rejects.toThrow();
    } finally {
      await stranger.cleanup();
    }
  });

  it("has no drift between the migrations and the Prisma schema", { timeout: 600_000 }, async () => {
    const base = process.env.TEST_DATABASE_URL!;
    const shadowName = `swb_shadow_${fixture.suffix}`;
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${shadowName}"`);
    const shadow = new URL(base);
    shadow.pathname = `/${shadowName}`;
    try {
      const { stdout } = await run("npx", ["prisma", "migrate", "diff", "--from-migrations", "prisma/migrations", "--to-schema-datamodel", "prisma/schema.prisma", "--shadow-database-url", shadow.toString(), "--exit-code"], { env: { ...process.env, DATABASE_URL: base, DIRECT_URL: base } });
      // --exit-code exits 2 (a rejected promise) on any difference; the raw constraints are invisible to Prisma.
      expect(stdout).toMatch(/No difference detected|empty migration/i);
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${shadowName}" WITH (FORCE)`);
    }
  });
});
