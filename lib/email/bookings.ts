import "server-only";

import type { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { manageBookingPath } from "@/lib/bookings/links";
import { BOOKING_NOTICES, type BookingNotice, type BookingNoticePayload } from "@/lib/bookings/notify";
import { checkInCode } from "@/lib/bookings/tokens";
import { bookingInvite } from "@/lib/ics/booking";
import { bookingEmailContent } from "./bookingContent";
import { absoluteUrl, sendBrandedEmail } from "./message";

/**
 * Deliver a booking notice (outbox kinds `booking-notice` and `booking-link`) through the makerspace's SMTP, with
 * the calendar invite attached to confirmations, approvals, changes (METHOD:REQUEST) and cancellations
 * (METHOD:CANCEL).
 */

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;
const isAmount = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0);

export function asBookingNoticePayload(value: Prisma.JsonValue): BookingNoticePayload | null {
  const p = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!p || !isId(p.makerspaceId) || !isId(p.bookingId) || !BOOKING_NOTICES.includes(p.notice as BookingNotice)) return null;
  if (p.occurrenceIds !== undefined && !(Array.isArray(p.occurrenceIds) && p.occurrenceIds.length <= 1000 && p.occurrenceIds.every(isId))) return null;
  if (p.manageToken !== undefined && !(typeof p.manageToken === "string" && p.manageToken.length <= 128)) return null;
  if (p.reason !== undefined && !(typeof p.reason === "string" && p.reason.length <= 1000)) return null;
  if (![p.keptFeeMinor, p.refundDueMinor, p.balanceDueMinor].every(isAmount)) return null;
  return p as unknown as BookingNoticePayload;
}

const INVITES: Partial<Record<BookingNotice, "REQUEST" | "CANCEL">> = { confirmed: "REQUEST", approved: "REQUEST", rescheduled: "REQUEST", cancelled: "CANCEL" };
const NOTICE_STATUSES: Partial<Record<BookingNotice, BookingStatus[]>> = {
  received: ["HELD"], requested: ["REQUESTED"], confirmed: ["CONFIRMED"], approved: ["CONFIRMED"],
  reminder: ["CONFIRMED"], "checked-in": ["CONFIRMED"], rescheduled: ["REQUESTED", "CONFIRMED"],
  declined: ["DECLINED"], "request-expired": ["EXPIRED"],
};

export async function deliverBookingNotice(payload: BookingNoticePayload, messageId: string): Promise<"sent" | "dropped"> {
  const booking = await prisma.booking.findFirst({
    where: { id: payload.bookingId, makerspaceId: payload.makerspaceId },
    include: { makerspace: { select: { name: true, slug: true, timezone: true, locale: true, contactEmail: true, contactPhone: true, addressLine: true, city: true } }, space: true, occurrences: true },
  });
  if (!booking || booking.contactEmail.endsWith("@hold.invalid")) return "dropped";
  const { makerspace } = booking;
  const recovery = payload.notice === "manage-link";
  const cancellation = ["cancelled", "declined", "request-expired"].includes(payload.notice);
  if (!recovery && !cancellation && ["CANCELLED", "DECLINED", "EXPIRED"].includes(booking.status)) return "dropped";
  if (!recovery && NOTICE_STATUSES[payload.notice] && !NOTICE_STATUSES[payload.notice]!.includes(booking.status)) return "dropped";
  const wanted = booking.occurrences.filter((row) =>
    (!payload.occurrenceIds?.length || payload.occurrenceIds.includes(row.id)) &&
    (recovery || (cancellation ? row.status === "CANCELLED" : row.status !== "CANCELLED")));
  if (wanted.length === 0) return "dropped";
  const firstOfSlot = new Map<number, (typeof wanted)[number]>();
  for (const row of [...wanted].sort((a, b) => a.unit - b.unit)) if (!firstOfSlot.has(row.slotIndex)) firstOfSlot.set(row.slotIndex, row);
  const slots = [...firstOfSlot.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const manageUrl = absoluteUrl(payload.manageToken ? manageBookingPath(makerspace.slug, payload.manageToken, booking.reference) : `/m/${makerspace.slug}/bookings/${booking.reference}`);
  const showCode = ["confirmed", "approved", "reminder"].includes(payload.notice);
  const content = bookingEmailContent({
    notice: payload.notice,
    makerspace: { name: makerspace.name, timezone: makerspace.timezone, locale: makerspace.locale, contactEmail: makerspace.contactEmail, contactPhone: makerspace.contactPhone },
    spaceName: booking.space.name,
    booking,
    slots,
    manageUrl,
    pageUrl: absoluteUrl(`/m/${makerspace.slug}`),
    checkInCode: showCode ? checkInCode(booking.makerspaceId, booking.reference) : null,
    keptFeeMinor: payload.keptFeeMinor,
    refundDueMinor: payload.refundDueMinor,
    balanceDueMinor: payload.balanceDueMinor,
    reason: payload.reason,
  });
  const method = INVITES[payload.notice];
  const attachments = method
    ? [
        {
          filename: `${booking.reference}.ics`,
          content: Buffer.from(
            bookingInvite(
              { booking, spaceName: booking.space.name, makerspace: { name: makerspace.name, contactEmail: makerspace.contactEmail, address: [makerspace.addressLine, makerspace.city].filter(Boolean).join(", ") || null }, manageUrl, now: new Date() },
              wanted,
              method,
            ),
          ),
          contentType: `text/calendar; charset=utf-8; method=${method}`,
        },
      ]
    : [];
  await sendBrandedEmail({ makerspaceId: booking.makerspaceId, to: booking.contactEmail, messageId, ...content, attachments });
  return "sent";
}
