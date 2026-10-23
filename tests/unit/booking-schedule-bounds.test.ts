import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadSchedule } from "@/lib/availability/context";
import { DEFAULT_RULES } from "@/lib/bookingRules/schema";
import { DAY_MS } from "@/lib/bookings/inputBounds";

const now = new Date("2030-01-01T00:00:00Z");
const query = { makerspaceId: "tenant", spaceId: "room", from: now, to: new Date(now.getTime() + 3_600_000), now };

function database() {
  const db = {
    space: { findFirst: vi.fn().mockResolvedValue({ id: "room", published: true }) },
    makerspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ timezone: "UTC", currency: "INR" }) },
    makerspaceBookingSettings: { findUnique: vi.fn().mockResolvedValue(DEFAULT_RULES) },
    openingHours: { findMany: vi.fn().mockResolvedValue([]) },
    hoursException: { findMany: vi.fn().mockResolvedValue([]) },
    blackout: { findMany: vi.fn().mockResolvedValue([]) },
    bookingOccurrence: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db, client: db as unknown as PrismaClient };
}

describe("schedule expansion bounds", () => {
  it("rejects invalid and over-400-day ranges before any database work", async () => {
    const { db, client } = database();
    for (const to of [new Date(NaN), now, new Date(now.getTime() - 1), new Date(now.getTime() + 401 * DAY_MS)]) {
      await expect(loadSchedule(client, { ...query, to })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(db.space.findFirst).not.toHaveBeenCalled();
    await expect(loadSchedule(client, { ...query, to: new Date(now.getTime() + 400 * DAY_MS) })).resolves.toHaveProperty("schedule");
  });
  it("rejects excessive booking duration and advance dates before calendar or busy queries", async () => {
    const { db, client } = database();
    await expect(loadSchedule(client, { ...query, bookingDurationMinutes: DEFAULT_RULES.maxDurationMinutes + 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const from = new Date(now.getTime() + 91 * DAY_MS);
    await expect(loadSchedule(client, { ...query, from, to: new Date(from.getTime() + 3_600_000), bookingDurationMinutes: 60 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.openingHours.findMany).not.toHaveBeenCalled(); expect(db.bookingOccurrence.findMany).not.toHaveBeenCalled();
  });
});
