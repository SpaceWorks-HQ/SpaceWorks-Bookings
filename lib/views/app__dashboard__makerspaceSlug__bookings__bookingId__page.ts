import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { allowed, makerspaceSummary } from "@/lib/bookings/staffView";
import { paymentState, PAYMENT_STATE_LABELS, balanceDue, refundDue } from "@/lib/bookings/obligation";
import { eventReason, snapshotLines } from "@/lib/bookings/ui";

export async function loadBooking({ params }: { params: Promise<{ makerspaceSlug: string; bookingId: string }> }) {
  const { makerspaceSlug, bookingId } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "bookings.view");
  const makerspaceId = access.makerspace.id;
  const contact = allowed(access, "bookings.contact");
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, makerspaceId }, select: {
    id: true, spaceId: true, reference: true, status: true, contactName: contact, contactEmail: contact, contactPhone: contact,
    attendees: true, quantity: true, purpose: true, internalNotes: contact, rateKind: true, currency: true,
    totalMinor: true, chargeMinor: true, paidMinor: true, refundedMinor: true, paymentDueAt: true, writtenOffAt: true, priceSnapshot: true,
    space: { select: { name: true } },
    occurrences: { where: { makerspaceId }, orderBy: [{ startsAt: "asc" }, { unit: "asc" }], select: { id: true, slotIndex: true, unit: true, startsAt: true, endsAt: true, status: true, priceMinor: true, checkedInAt: true, noShowAt: true } },
    events: { where: { makerspaceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, kind: true, actorKind: true, createdAt: true, data: true } },
  } });
  if (!booking) notFound();
  const { priceSnapshot, occurrences, events, paymentDueAt, writtenOffAt, ...row } = booking;
  return { makerspace: await makerspaceSummary(makerspaceId), booking: { ...row, contactName: contact ? row.contactName : null, contactEmail: contact ? row.contactEmail : null, contactPhone: contact ? row.contactPhone : null,
    internalNotes: contact ? row.internalNotes : null, paymentDueAt: paymentDueAt?.toISOString() ?? null, writtenOffAt: writtenOffAt?.toISOString() ?? null,
    paymentLabel: PAYMENT_STATE_LABELS[paymentState(booking, new Date())], balanceDue: balanceDue(booking.chargeMinor, booking), refundDue: refundDue(booking.chargeMinor, booking),
    lines: snapshotLines(priceSnapshot), occurrences: occurrences.map((item) => ({ ...item, startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), checkedInAt: item.checkedInAt?.toISOString() ?? null, noShowAt: item.noShowAt?.toISOString() ?? null })),
    events: events.map((item) => ({ id: item.id, kind: item.kind, actorKind: item.actorKind, createdAt: item.createdAt.toISOString(), reason: contact ? eventReason(item.data) : null })),
  }, canContact: contact, canManage: allowed(access, "bookings.manage"), canApprove: allowed(access, "bookings.approve"), canOverride: allowed(access, "bookings.override"),
    spaces: await prisma.space.findMany({ where: { makerspaceId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  };
}
