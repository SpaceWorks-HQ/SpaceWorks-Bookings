import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { paymentState, PAYMENT_STATE_LABELS } from "@/lib/bookings/obligation";

export async function loadAccountBookingsPage() {
  const session = await requireAuth();
  const userId = session.user.id;
  const [bookings, feeds] = await Promise.all([
    prisma.booking.findMany({ where: { customerUserId: userId, submittedAt: { not: null } }, orderBy: { createdAt: "desc" },
      include: { makerspace: { select: { slug: true, name: true, timezone: true } }, space: { select: { name: true } }, occurrences: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } } } }),
    prisma.calendarFeed.findMany({ where: { userId, kind: "CUSTOMER", revokedAt: null }, select: { tokenHint: true, makerspace: { select: { slug: true, name: true } } } }),
  ]);
  const makerspaces = new Map(bookings.map((row) => [row.makerspace.slug, { ...row.makerspace, feed: feeds.find((feed) => feed.makerspace.slug === row.makerspace.slug) ?? null }]));
  for (const feed of feeds) if (!makerspaces.has(feed.makerspace.slug)) makerspaces.set(feed.makerspace.slug, { ...feed.makerspace, timezone: "UTC", feed });
  return { bookings: bookings.map((row) => ({ id: row.id, reference: row.reference, status: row.status, makerspace: row.makerspace, spaceName: row.space.name,
    startsAt: row.occurrences[0]?.startsAt ?? null, currency: row.currency, totalMinor: row.totalMinor, paymentLabel: PAYMENT_STATE_LABELS[paymentState(row, new Date())] })),
    makerspaces: [...makerspaces.values()].map((item) => ({ slug: item.slug, name: item.name, feed: item.feed ? { tokenHint: item.feed.tokenHint } : null })) };
}
