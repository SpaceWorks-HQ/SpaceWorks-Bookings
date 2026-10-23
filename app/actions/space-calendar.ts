"use server";

import { prisma } from "@/lib/db";
import { notFound } from "@/lib/bookings/errors";
import * as calendar from "@/lib/spaces/calendar";
import { staffAction } from "@/lib/actions/bookingContext";
import * as inputs from "@/lib/actions/settingsInputs";
import type { Capability } from "@/lib/permissionRoles";

const capabilities = (data: { spaceId: string | null }): Capability[] => [data.spaceId ? "spaces.manage" : "makerspace.settings"];

export async function replaceOpeningHours(input: unknown) {
  return staffAction(inputs.openingHoursSchema, input, capabilities,
    (data, ctx) => calendar.replaceOpeningHours({ ...ctx, spaceId: data.spaceId, hours: data.hours, openAllDay: data.openAllDay }));
}

export async function setHoursException(input: unknown) {
  return staffAction(inputs.hoursExceptionSchema, input, capabilities,
    (data, ctx) => calendar.setHoursException({ ...ctx, spaceId: data.spaceId, exception: data.exception }));
}

export async function removeHoursException(input: unknown) {
  return staffAction(inputs.removeExceptionSchema, input, capabilities, async (data, ctx) => {
    const row = await prisma.hoursException.findFirst({ where: { id: data.exceptionId, makerspaceId: ctx.makerspaceId, spaceId: data.spaceId }, select: { id: true } });
    if (!row) throw notFound("Exception");
    return calendar.removeHoursException({ ...ctx, exceptionId: row.id });
  });
}

export async function createBlackout(input: unknown) {
  return staffAction(inputs.createBlackoutSchema, input, capabilities,
    (data, ctx) => calendar.createBlackout({ ...ctx, spaceId: data.spaceId, blackout: data.blackout }));
}

export async function removeBlackout(input: unknown) {
  return staffAction(inputs.removeBlackoutSchema, input, capabilities, async (data, ctx) => {
    const row = await prisma.blackout.findFirst({ where: { id: data.blackoutId, makerspaceId: ctx.makerspaceId, spaceId: data.spaceId }, select: { id: true } });
    if (!row) throw notFound("Blackout");
    return calendar.removeBlackout({ ...ctx, blackoutId: row.id });
  });
}
