"use server";

import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { currentRequestBlocked } from "@/lib/ipBlock";
import { getSpaceRules } from "@/lib/bookingRules/service";
import * as holds from "@/lib/bookings/hold";
import * as expiry from "@/lib/bookings/expiry";
import * as submit from "@/lib/bookings/submit";
import * as quotes from "@/lib/bookings/quote";
import * as links from "@/lib/bookings/links";
import * as cancel from "@/lib/bookings/cancel";
import * as reschedule from "@/lib/bookings/reschedule";
import * as feeds from "@/lib/ics/feeds";
import * as attendance from "@/lib/bookings/checkin";
import { checkInCode } from "@/lib/bookings/tokens";
import { publicBookingPlan } from "@/lib/actions/publicBookingPlan";
import { expandRecurrence, RecurrenceError } from "@/lib/bookings/recurrence";
import { parseDateKey } from "@/lib/time/zoned";
import { forbidden, invalidInput } from "@/lib/bookings/errors";
import { customerBooking, customerHold, ownHoldExclusions, publicAction, publishedSpace, verifiedMemberEmail } from "@/lib/actions/publicBookingContext";
import { assertBookingBounds, assertScheduleWindow } from "@/lib/bookings/inputBounds";
import { inputFailure } from "@/lib/actions/bookingContext";
import { sendBookingRefunds } from "@/lib/bookings/money/send";
import * as inputs from "@/lib/actions/bookingInputs";
import type { ActionResult } from "./makerspace";

export async function previewQuote(input: unknown) {
  return publicAction(inputs.quoteSchema, input, async (data, ctx) => {
    await publishedSpace(ctx.makerspaceId, data.spaceId);
    const rules = (await getSpaceRules(ctx.makerspaceId, data.spaceId)).values;
    assertBookingBounds(data.start, (data.end.getTime() - data.start.getTime()) / 60_000, rules);
    const excludeBookingIds = await ownHoldExclusions(ctx.makerspaceId, ctx.actor, data);
    let slots;
    if (data.skipConflicts) {
      const plan = await publicBookingPlan({ ...data, ...ctx, excludeBookingIds });
      slots = plan.slots.filter((_, index) => plan.checked.allocations[index]);
    } else {
      try {
        slots = expandRecurrence(data.start, data.end, ctx.timeZone, data.recurrence ? {
          ...data.recurrence, until: data.recurrence.until ? parseDateKey(data.recurrence.until)! : undefined,
        } : null, rules.recurrenceMaxOccurrences);
      } catch (error) {
        if (error instanceof RecurrenceError) throw invalidInput(error.message);
        throw error;
      }
      if (slots.some((slot) => slot.nonexistent)) throw invalidInput("Choose valid times for the series.");
    }
    if (!slots.length) throw invalidInput("Choose at least one available date.");
    assertScheduleWindow(slots[0].start, slots[slots.length - 1].end);
    return quotes.previewQuote({ ...ctx, ...data, slots, memberEmail: await verifiedMemberEmail(ctx.actor) });
  }, { active: true });
}

export async function createHold(input: unknown) {
  return publicAction(inputs.holdSchema, input, async (data, ctx) => {
    await publishedSpace(ctx.makerspaceId, data.spaceId);
    // Guests may not hold slots on spaces that only take signed-in bookings.
    if (!ctx.actor.userId && !(await getSpaceRules(ctx.makerspaceId, data.spaceId)).values.guestBookingAllowed) throw forbidden("Sign in to book this space.");
    return holds.createHold({ ...data, ...ctx, source: "PUBLIC" });
  }, { active: true, mutation: true });
}

export async function submitBooking(input: unknown) {
  return publicAction(inputs.submitSchema, input, async (data, ctx) => {
    const owned = await customerHold(ctx.makerspaceId, ctx.actor, data);
    await publishedSpace(ctx.makerspaceId, owned.booking.spaceId);
    const rules = (await getSpaceRules(ctx.makerspaceId, owned.booking.spaceId)).values;
    if (!owned.booking.customerUserId && !rules.guestBookingAllowed) throw forbidden("Sign in to book this space.");
    return submit.submitBooking({ ...data, makerspaceId: ctx.makerspaceId, actor: owned.actor });
  }, { active: true, mutation: true });
}

export async function releaseHold(input: unknown) {
  return publicAction(inputs.releaseHoldSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data, true);
    return expiry.releaseHold({ makerspaceId: ctx.makerspaceId, bookingId: owned.booking.id, actor: owned.actor });
  }, { mutation: true });
}

/** Email and reference matches, unknown makerspaces, blocked requests and limits all get the same answer. */
export async function requestManageLink(input: unknown): Promise<ActionResult<{ sent: true }>> {
  const parsed = inputs.manageLinkSchema.safeParse(input);
  if (!parsed.success) return inputFailure(parsed.error);
  const answer = { ok: true, data: { sent: true } } as const;
  try {
    if (await currentRequestBlocked() || await isActionRateLimited("magicLink", parsed.data.email)) return answer;
    const makerspace = await prisma.makerspace.findUnique({ where: { slug: parsed.data.makerspaceSlug }, select: { id: true } });
    if (makerspace) await links.requestManageLink({ ...parsed.data, makerspaceId: makerspace.id });
  } catch {
    console.error("[bookings] manage link request failed");
  }
  return answer;
}

export async function cancelByManageToken(input: unknown) {
  const result = await publicAction(inputs.tokenCancelSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    return cancel.cancelBooking({ ...data, makerspaceId: ctx.makerspaceId, bookingId: owned.booking.id, actor: owned.actor, kind: "CUSTOMER" });
  }, { mutation: true });
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function rescheduleByManageToken(input: unknown) {
  const result = await publicAction(inputs.tokenRescheduleSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    return reschedule.rescheduleOccurrence({ ...data, makerspaceId: ctx.makerspaceId, bookingId: owned.booking.id, actor: owned.actor });
  }, { active: true, mutation: true });
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function cancelBooking(input: unknown) {
  const result = await publicAction(inputs.cancelSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    return cancel.cancelBooking({ ...data, makerspaceId: ctx.makerspaceId, actor: owned.actor, kind: "CUSTOMER" });
  }, { signedIn: true, mutation: true });
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function rescheduleOccurrence(input: unknown) {
  const result = await publicAction(inputs.rescheduleSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    return reschedule.rescheduleOccurrence({ ...data, makerspaceId: ctx.makerspaceId, actor: owned.actor });
  }, { active: true, signedIn: true, mutation: true });
  if (result.ok && result.data) await sendBookingRefunds(result.data.refundIds);
  return result;
}

export async function issuePersonalCalendarFeed(input: unknown) {
  return publicAction(inputs.slugSchema, input, (_data, ctx) => feeds.issueCalendarFeed({ ...ctx, kind: "CUSTOMER" }), { signedIn: true, mutation: true });
}

export async function revokePersonalCalendarFeed(input: unknown) {
  return publicAction(inputs.slugSchema, input, (_data, ctx) => feeds.revokeCalendarFeed({ makerspaceId: ctx.makerspaceId, userId: ctx.actor.userId!, kind: "CUSTOMER" }), { signedIn: true, mutation: true });
}

/** Self check-in from the manage page; the domain enforces the space's self check-in rule and window. */
export async function selfCheckIn(input: unknown) {
  return publicAction(inputs.selfCheckInSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    return attendance.checkIn({ makerspaceId: ctx.makerspaceId, actor: owned.actor, code: checkInCode(ctx.makerspaceId, owned.booking.reference) });
  }, { active: true, mutation: true });
}
