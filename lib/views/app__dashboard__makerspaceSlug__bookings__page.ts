import type { Prisma, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { allowed, makerspaceSummary, pageNumber, type DirectoryProps } from "@/lib/bookings/staffView";
import { BOOKING_STATUSES, localDayRange } from "@/lib/bookings/ui";
import { paymentState, PAYMENT_STATE_LABELS } from "@/lib/bookings/obligation";

export async function loadBookings({ params, searchParams }: DirectoryProps) {
  const { makerspaceSlug } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "bookings.view");
  const makerspaceId = access.makerspace.id;
  const makerspace = await makerspaceSummary(makerspaceId);
  const contact = allowed(access, "bookings.contact");
  const search = await searchParams;
  const page = pageNumber(search.page);
  const q = (search.q ?? "").trim().slice(0, 100);
  const status = BOOKING_STATUSES.includes(search.status as BookingStatus) ? search.status as BookingStatus : undefined;
  const from = localDayRange(search.from ?? "", makerspace.timezone);
  const to = localDayRange(search.to ?? "", makerspace.timezone);
  const where: Prisma.BookingWhereInput = { makerspaceId, ...(status ? { status } : {}), ...(search.space ? { spaceId: search.space } : {}),
    ...(from || to ? { occurrences: { some: { makerspaceId, startsAt: { ...(from ? { gte: from.start } : {}), ...(to ? { lt: to.end } : {}) } } } } : {}),
    ...(q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, ...(contact ? [{ contactName: { contains: q, mode: "insensitive" as const } }, { contactEmail: { contains: q, mode: "insensitive" as const } }] : [])] } : {}),
  };
  const [rows, total, spaces, feed] = await Promise.all([
    prisma.booking.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50, select: {
      id: true, reference: true, status: true, contactName: contact, contactEmail: contact, totalMinor: true, chargeMinor: true, paidMinor: true, refundedMinor: true, paymentDueAt: true, writtenOffAt: true,
      space: { select: { name: true } }, occurrences: { where: { makerspaceId }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true, endsAt: true } },
    } }),
    prisma.booking.count({ where }),
    prisma.space.findMany({ where: { makerspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.calendarFeed.findFirst({ where: { makerspaceId, userId: access.userId, kind: "STAFF", revokedAt: null }, select: { tokenHint: true } }),
  ]);
  return { makerspace, contact, canManage: allowed(access, "bookings.manage"), rows: rows.map((row) => ({ id: row.id, reference: row.reference, status: row.status,
    name: contact ? row.contactName : null, email: contact ? row.contactEmail : null, spaceName: row.space.name,
    paymentLabel: PAYMENT_STATE_LABELS[paymentState(row, new Date())], startsAt: row.occurrences[0]?.startsAt.toISOString() ?? null, endsAt: row.occurrences[0]?.endsAt.toISOString() ?? null })),
    spaces, feed, q, status: status ?? "", space: search.space ?? "", from: from ? search.from : "", to: to ? search.to : "", page, pages: Math.max(1, Math.ceil(total / 50)) };
}
