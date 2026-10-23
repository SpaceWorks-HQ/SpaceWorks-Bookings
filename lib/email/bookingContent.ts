import type { BookingStatus, ChargeMode } from "@prisma/client";
import type { BookingNotice } from "@/lib/bookings/notify";
import { formatDate, formatDayShort, formatTimeRange } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";

/**
 * The words of every booking email, per notice. Pure (unit-tested); lib/email/bookings.ts loads the data, renders
 * it with the branded layout and attaches the calendar file.
 */

export type BookingEmailData = {
  notice: BookingNotice;
  makerspace: { name: string; timezone: string; locale: string | null; contactEmail?: string | null; contactPhone?: string | null };
  spaceName: string;
  booking: {
    reference: string;
    status: BookingStatus;
    contactName: string;
    currency: string;
    totalMinor: number;
    depositMinor: number;
    chargeMinor: number;
    paidMinor: number;
    refundedMinor: number;
    paymentDueAt: Date | null;
    payLater: boolean;
    awaitingPayment: boolean;
    chargeMode: ChargeMode;
  };
  slots: Array<{ startsAt: Date; endsAt: Date }>;
  manageUrl: string | null;
  pageUrl: string;
  checkInCode: string | null;
  keptFeeMinor?: number;
  refundDueMinor?: number;
  balanceDueMinor?: number;
  reason?: string;
};

export type BookingEmailContent = { subject: string; heading: string; paragraphs: string[]; action: { label: string; url: string }; footnote?: string };

const MAX_LISTED = 6;

export function describeSlots(slots: BookingEmailData["slots"], timeZone: string): string[] {
  const lines = slots.slice(0, MAX_LISTED).map((slot) => `${formatDayShort(slot.startsAt, timeZone, slot.startsAt)} ${formatDate(slot.startsAt, timeZone).split(" ").pop()}, ${formatTimeRange(slot.startsAt, slot.endsAt, timeZone)}`);
  if (slots.length > MAX_LISTED) lines.push(`and ${slots.length - MAX_LISTED} more`);
  return lines;
}

function paymentLines(data: BookingEmailData): string[] {
  const { booking, makerspace } = data;
  const amount = (minor: number) => money(minor, booking.currency, makerspace.locale);
  if (booking.totalMinor === 0 || booking.chargeMode === "FREE") return ["There's nothing to pay."];
  const balance = Math.max(0, booking.chargeMinor - (booking.paidMinor - booking.refundedMinor));
  if (booking.status === "REQUESTED") return [`Price: ${amount(booking.totalMinor)}. You pay nothing until the request is approved.`];
  if (booking.awaitingPayment) return [`Payment pending: ${amount(booking.depositMinor || booking.totalMinor)}. Contact ${makerspace.name}${makerspace.contactEmail ? ` at ${makerspace.contactEmail}` : makerspace.contactPhone ? ` on ${makerspace.contactPhone}` : ""} to arrange payment before your hold expires.`];
  if (balance === 0) return [`Total: ${amount(booking.totalMinor)}, paid.`];
  const due = booking.paymentDueAt ? ` by ${formatDate(booking.paymentDueAt, makerspace.timezone)}` : "";
  return [`Payment pending: ${amount(balance)} to pay${due}.`];
}

export function bookingEmailContent(data: BookingEmailData): BookingEmailContent {
  const { makerspace, spaceName, booking } = data;
  const first = booking.contactName.split(/\s+/)[0] || booking.contactName;
  const when = describeSlots(data.slots, makerspace.timezone);
  const whereWhen = [`${spaceName}, ${makerspace.name}`, ...when];
  const ref = `Reference ${booking.reference}.`;
  const manage = data.manageUrl ? { label: "Manage your booking", url: data.manageUrl } : { label: `Visit ${makerspace.name}`, url: data.pageUrl };
  const amount = (minor: number) => money(minor, booking.currency, makerspace.locale);
  const checkIn = data.checkInCode ? `Your check-in code is ${data.checkInCode}.` : null;
  const footnote = data.manageUrl ? "Keep your original private booking link. You can also sign in to the account that booked, or request a fresh link from the booking page." : undefined;
  switch (data.notice) {
    case "received":
      return { subject: `Booking held at ${makerspace.name}`, heading: "We're holding your booking", paragraphs: [`Hi ${first}, we're holding this for you while you pay.`, ...whereWhen, ...paymentLines(data), ref], action: manage, footnote };
    case "requested":
      return { subject: `Request sent to ${makerspace.name}`, heading: "Request received", paragraphs: [`Hi ${first}, ${makerspace.name} will review your request and email you their answer.`, ...whereWhen, ...paymentLines(data), ref], action: manage, footnote };
    case "confirmed":
    case "approved":
      return {
        subject: `${data.notice === "approved" ? "Approved" : "Confirmed"}: ${spaceName} at ${makerspace.name}`,
        heading: data.notice === "approved" ? "Your request is approved" : "You're booked",
        paragraphs: [`Hi ${first}, your booking is confirmed.`, ...whereWhen, ...paymentLines(data), ...(checkIn ? [checkIn] : []), ref, "The calendar invite is attached."],
        action: manage,
        footnote,
      };
    case "declined":
      return { subject: `${makerspace.name} couldn't accept your request`, heading: "Request declined", paragraphs: [`Hi ${first}, ${makerspace.name} declined your request for ${spaceName}.`, ...(data.reason ? [`Their note: ${data.reason}`] : []), ...when, "You haven't been charged.", ref], action: manage };
    case "request-expired":
      return { subject: `Your request to ${makerspace.name} expired`, heading: "Request expired", paragraphs: [`Hi ${first}, ${makerspace.name} didn't answer your request for ${spaceName} in time, so it has expired.`, ...when, "You haven't been charged. You're welcome to book again.", ref], action: manage };
    case "reminder":
      return { subject: `Reminder: ${spaceName} at ${makerspace.name}`, heading: "See you soon", paragraphs: [`Hi ${first}, a reminder of your booking.`, ...whereWhen, ...paymentLines(data).filter((line) => line.startsWith("Payment pending")), ...(checkIn ? [checkIn] : []), ref], action: manage };
    case "cancelled": {
      const money = [
        ...(data.keptFeeMinor ? [`Cancellation fee kept under the policy: ${amount(data.keptFeeMinor)}.`] : []),
        ...(data.refundDueMinor ? [`Refund due to you: ${amount(data.refundDueMinor)}. We'll email you when it's on its way.`] : []),
        ...(data.balanceDueMinor ? [`Still to pay: ${amount(data.balanceDueMinor)}.`] : []),
      ];
      return { subject: `Cancelled: ${spaceName} at ${makerspace.name}`, heading: "Booking cancelled", paragraphs: [`Hi ${first}, these times are cancelled.`, ...whereWhen, ...(data.reason ? [`Note from ${makerspace.name}: ${data.reason}`] : []), ...money, ref], action: manage };
    }
    case "rescheduled":
      return { subject: `Changed: ${spaceName} at ${makerspace.name}`, heading: "Your booking has changed", paragraphs: [`Hi ${first}, your booking now looks like this.`, ...whereWhen, ...paymentLines(data), ref, "The updated calendar invite is attached."], action: manage };
    case "checked-in":
      return { subject: `Checked in at ${makerspace.name}`, heading: "You're checked in", paragraphs: [`Hi ${first}, you're checked in to ${spaceName} at ${makerspace.name}. Enjoy your session.`, ref], action: manage };
    case "payment-due":
      return { subject: `Payment due for your booking at ${makerspace.name}`, heading: "Payment due soon", paragraphs: [`Hi ${first}, a payment for your booking is due soon.`, ...whereWhen, ...paymentLines(data), ref], action: manage };
    case "payment-overdue":
      return { subject: `Payment overdue for your booking at ${makerspace.name}`, heading: "Payment overdue", paragraphs: [`Hi ${first}, the payment for your booking is overdue.`, ...whereWhen, ...paymentLines(data), `Contact ${makerspace.name} to arrange payment and keep your booking.`, ref], action: manage };
    case "manage-link":
      return { subject: `Your booking at ${makerspace.name}`, heading: "Your booking link", paragraphs: [`Hi ${first}, here is a fresh link to your booking. Older links no longer work.`, ...whereWhen, ref], action: manage, footnote };
  }
}
