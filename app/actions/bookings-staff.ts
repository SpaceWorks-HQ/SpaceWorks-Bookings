"use server";

import { prisma } from "@/lib/db";
import * as holds from "@/lib/bookings/hold";
import * as submit from "@/lib/bookings/submit";
import * as approval from "@/lib/bookings/approval";
import * as cancel from "@/lib/bookings/cancel";
import * as reschedule from "@/lib/bookings/reschedule";
import * as move from "@/lib/bookings/move";
import * as attendance from "@/lib/bookings/checkin";
import * as feeds from "@/lib/ics/feeds";
import { verifyCheckInCode } from "@/lib/bookings/tokens";
import { invalidInput, notFound } from "@/lib/bookings/errors";
import { staffAction } from "@/lib/actions/bookingContext";
import { sendBookingRefunds } from "@/lib/bookings/money/send";
import * as inputs from "@/lib/actions/bookingInputs";
import type { Capability } from "@/lib/permissionRoles";

const manageCapabilities = (data: { overrideReason?: string | null }): Capability[] =>
  data.overrideReason ? ["bookings.manage", "bookings.override"] : ["bookings.manage"];

/** The staff flow holds a slot first, then submits the customer's details against that hold. */
export async function createHold(input: unknown) {
  return staffAction(inputs.staffHoldSchema, input, manageCapabilities,
    (data, ctx) => holds.createHold({ ...data, ...ctx, source: "STAFF" }));
}

export async function submitBooking(input: unknown) {
  return staffAction(inputs.staffSubmitSchema, input, "bookings.manage",
    (data, ctx) => submit.submitBooking({ ...data, ...ctx }));
}

export async function approveBooking(input: unknown) {
  return staffAction(inputs.approveSchema, input,
    (data) => data.overrideReason ? ["bookings.approve", "bookings.override"] : ["bookings.approve"],
    async (data, ctx) => {
      const booking = await approval.approveBooking({ ...data, ...ctx });
      return { bookingId: booking.id, reference: booking.reference, status: booking.status };
    });
}

export async function declineBooking(input: unknown) {
  return staffAction(inputs.declineSchema, input, "bookings.approve", async (data, ctx) => {
    const booking = await approval.declineBooking({ ...data, ...ctx });
    return { bookingId: booking.id, reference: booking.reference, status: booking.status };
  });
}

export async function cancelBooking(input: unknown) {
  const result = await staffAction(inputs.staffCancelSchema, input,
    (data) => data.kind === "VENUE" ? ["bookings.manage", "bookings.override"] : ["bookings.manage"],
    (data, ctx) => cancel.cancelBooking({ ...data, ...ctx }));
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function rescheduleOccurrence(input: unknown) {
  const result = await staffAction(inputs.staffRescheduleSchema, input, manageCapabilities,
    (data, ctx) => reschedule.rescheduleOccurrence({ ...data, ...ctx }));
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function moveBooking(input: unknown) {
  return staffAction(inputs.moveSchema, input, manageCapabilities, async (data, ctx) => {
    const booking = await move.moveBooking({ ...data, ...ctx });
    return { bookingId: booking.id, spaceId: booking.spaceId };
  });
}

export async function checkIn(input: unknown) {
  return staffAction(inputs.checkInSchema, input, "bookings.manage", async (data, ctx) => {
    // Both supplied ids must refer to the same booking in this makerspace.
    const row = await prisma.bookingOccurrence.findFirst({ where: {
      makerspaceId: ctx.makerspaceId, ...(data.occurrenceId ? { id: data.occurrenceId } : { status: "SCHEDULED", endsAt: { gt: new Date() } }),
      ...(data.bookingId ? { bookingId: data.bookingId } : {}),
    }, orderBy: { startsAt: "asc" }, select: { id: true } });
    if (!row) throw notFound("Occurrence");
    return attendance.checkIn({ ...ctx, occurrenceId: row.id });
  });
}

export async function checkInByCode(input: unknown) {
  return staffAction(inputs.checkInCodeSchema, input, "bookings.manage", (data, ctx) => {
    if (!verifyCheckInCode(ctx.makerspaceId, data.code)) throw invalidInput("That check-in code isn't valid.");
    return attendance.checkIn({ ...ctx, code: data.code });
  });
}

export async function markNoShow(input: unknown) {
  return staffAction(inputs.occurrenceSchema, input, "bookings.manage",
    (data, ctx) => attendance.markNoShow({ ...ctx, occurrenceId: data.occurrenceId }));
}

export async function issueStaffCalendarFeed(input: unknown) {
  return staffAction(inputs.slugSchema, input, "bookings.view", (_data, ctx) => feeds.issueCalendarFeed({ ...ctx, kind: "STAFF" }));
}

export async function revokeStaffCalendarFeed(input: unknown) {
  return staffAction(inputs.slugSchema, input, "bookings.view",
    (_data, ctx) => feeds.revokeCalendarFeed({ makerspaceId: ctx.makerspaceId, userId: ctx.actor.userId, kind: "STAFF" }));
}
