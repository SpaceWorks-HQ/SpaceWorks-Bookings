import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { allowed, makerspaceSummary, type RouteProps } from "@/lib/bookings/staffView";
import { addLocalDays, dateKey, localParts, startOfLocalDay } from "@/lib/time/zoned";
import { effectiveRules } from "@/lib/bookingRules/effective";
import { pickRules } from "@/lib/bookingRules/schema";

export async function loadToday({ params }: RouteProps) {
  const { makerspaceSlug } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "bookings.view");
  const makerspaceId = access.makerspace.id;
  const makerspace = await makerspaceSummary(makerspaceId);
  const now = new Date();
  const today = localParts(now, makerspace.timezone).date;
  const start = startOfLocalDay(today, makerspace.timezone);
  const end = startOfLocalDay(addLocalDays(today, 1), makerspace.timezone);
  const contact = allowed(access, "bookings.contact");
  const defaults = pickRules(await prisma.makerspaceBookingSettings.findUnique({ where: { makerspaceId } }));
  const spaces = await prisma.space.findMany({ where: { makerspaceId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, ruleOverrides: true } });
  const rows = await prisma.bookingOccurrence.findMany({ where: { makerspaceId, startsAt: { lt: end }, endsAt: { gt: start }, booking: { status: { in: ["CONFIRMED", "REQUESTED"] } } }, orderBy: [{ startsAt: "asc" }, { unit: "asc" }], select: {
    id: true, bookingId: true, spaceId: true, slotIndex: true, unit: true, status: true, startsAt: true, endsAt: true, noShowAt: true,
    booking: { select: { reference: true, contactName: contact, status: true, attendees: true, quantity: true } },
  } });
  return { makerspace, date: dateKey(today), canManage: allowed(access, "bookings.manage"), spaces: spaces.map(({ id, name }) => ({ id, name })),
    rows: rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), noShowAt: row.noShowAt?.toISOString() ?? null,
      booking: { ...row.booking, contactName: contact ? row.booking.contactName : null },
      canCheckIn: row.booking.status === "CONFIRMED" && row.status === "SCHEDULED" && now < row.endsAt && now.getTime() >= row.startsAt.getTime() - 86400000,
      canNoShow: row.booking.status === "CONFIRMED" && row.status === "SCHEDULED" && !row.noShowAt && now.getTime() >= row.startsAt.getTime() + effectiveRules(defaults, spaces.find((space) => space.id === row.spaceId)).values.noShowGraceMinutes * 60000,
    })) };
}
