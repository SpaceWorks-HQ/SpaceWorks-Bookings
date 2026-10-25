import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { allowed, makerspaceSummary } from "@/lib/bookings/staffView";
import { bookingDate, bookingDayWindow } from "@/lib/bookings/publicUi";
import { calendarDays, placeOnGrid, shiftDay, type CalendarView } from "@/lib/bookings/calendarGrid";

/** The staff calendar: spaces by days, each cell listing the live and past occurrences on that local day. */
export async function loadCalendar({ params, searchParams }: { params: Promise<{ makerspaceSlug: string }>; searchParams: Promise<{ view?: string; date?: string; space?: string }> }) {
  const { makerspaceSlug } = await params;
  const query = await searchParams;
  const access = await requireMakerspaceCapability(makerspaceSlug, "bookings.view");
  const makerspace = await makerspaceSummary(access.makerspace.id);
  const view: CalendarView = query.view === "day" ? "day" : "week";
  const today = bookingDate(new Date(), makerspace.timezone);
  const days = calendarDays(query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today, view);
  const range = { from: bookingDayWindow(days[0], makerspace.timezone).start, to: bookingDayWindow(days.at(-1)!, makerspace.timezone).end };
  const contact = allowed(access, "bookings.contact");
  const spaces = await prisma.space.findMany({ where: { makerspaceId: access.makerspace.id, archivedAt: null, ...(query.space ? { id: query.space } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, units: true } });
  const rows = await prisma.bookingOccurrence.findMany({
    where: { makerspaceId: access.makerspace.id, spaceId: { in: spaces.map((space) => space.id) }, status: { not: "CANCELLED" }, startsAt: { lt: range.to }, endsAt: { gt: range.from }, booking: { status: { in: ["HELD", "REQUESTED", "CONFIRMED"] } } },
    select: { id: true, spaceId: true, unit: true, startsAt: true, endsAt: true, status: true, booking: { select: { id: true, reference: true, status: true, contactName: true, attendees: true } } },
  });
  const items = rows.map((row) => ({ id: row.id, spaceId: row.spaceId, startsAt: row.startsAt.getTime(), endsAt: row.endsAt.getTime(), unit: row.unit, status: row.status,
    booking: { id: row.booking.id, reference: row.booking.reference, status: row.booking.status, name: contact ? row.booking.contactName : null, attendees: row.booking.attendees } }));
  const grid = placeOnGrid(items, days, makerspace.timezone);
  return {
    makerspace, view, days, today, spaceFilter: query.space ?? "",
    previous: shiftDay(days[0], view, -1), next: shiftDay(days[0], view, 1),
    allSpaces: await prisma.space.findMany({ where: { makerspaceId: access.makerspace.id, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    rows: spaces.map((space) => ({ ...space, cells: days.map((day) => ({ day, items: grid.get(`${space.id}|${day}`) ?? [] })) })),
    empty: items.length === 0,
  };
}
