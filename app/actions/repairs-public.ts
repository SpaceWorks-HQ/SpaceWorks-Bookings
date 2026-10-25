"use server";

import { isActionRateLimited } from "@/lib/actionRateLimit";
import { inputFailure, bookingFailure } from "@/lib/actions/bookingContext";
import { customerBooking, publicAction } from "@/lib/actions/publicBookingContext";
import * as inputs from "@/lib/actions/repairInputs";
import { forbidden, notFound } from "@/lib/bookings/errors";
import { prisma } from "@/lib/db";
import * as issues from "@/lib/repairs/issues";
import { answerByLink, findRequestByToken } from "@/lib/repairs/requests";
import { attachIssuePhoto } from "@/lib/repairs/photos";
import type { ActionResult } from "./makerspace";

/**
 * Repairs without a team account: a customer reports a problem with the space they booked (from their booking page),
 * and an external technician answers a request and records the work through their link. Both are rate limited.
 */

export async function reportIssueFromBooking(input: unknown) {
  return publicAction(inputs.customerReportSchema, input, async (data, ctx) => {
    const owned = await customerBooking(ctx.makerspaceId, ctx.actor, data);
    if (await isActionRateLimited("create", owned.booking.id)) throw forbidden("Too many reports. Please try again later.");
    const issue = await issues.reportIssue({ makerspaceId: ctx.makerspaceId, spaceId: owned.booking.spaceId, actor: owned.actor, bookingId: owned.booking.id, title: data.title, description: data.description, severity: data.severity });
    return { reference: issue.reference };
  }, { active: true, mutation: true });
}

/** The live request behind a link: open, or accepted and still the technician's. Anything else is not found. */
async function liveLink(token: string) {
  const request = await findRequestByToken(token);
  if (!request || request.expiresAt <= new Date() || !["SENT", "ACCEPTED"].includes(request.status)) throw notFound("Request");
  return request;
}

async function linkAction<T>(token: unknown, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    if (await isActionRateLimited("action", typeof token === "string" ? token.slice(0, 16) : undefined)) throw forbidden("Too many requests. Please try again later.");
    return { ok: true, data: await work() };
  } catch (error) {
    return bookingFailure(error);
  }
}

export async function answerRepairLink(input: unknown) {
  const parsed = inputs.linkAnswerSchema.safeParse(input);
  if (!parsed.success) return inputFailure(parsed.error);
  return linkAction(parsed.data.token, () => answerByLink(parsed.data));
}

export async function recordFixByLink(input: unknown) {
  const parsed = inputs.linkFixSchema.safeParse(input);
  if (!parsed.success) return inputFailure(parsed.error);
  return linkAction(parsed.data.token, async () => {
    const request = await liveLink(parsed.data.token);
    if (request.status !== "ACCEPTED") throw notFound("Request");
    return issues.recordFix({ makerspaceId: request.makerspaceId, issueId: request.issueId, actor: { kind: "LINK", technicianId: request.technicianId }, remarks: parsed.data.remarks, partsUsed: parsed.data.partsUsed, amountAskedMinor: parsed.data.amountAskedMinor });
  });
}

export async function addPhotoByLink(formData: FormData) {
  const token = formData.get("token");
  if (typeof token !== "string" || !inputs.linkToken.safeParse(token).success) return { ok: false, error: "Request not found." } as const;
  return linkAction(token, async () => {
    if (await isActionRateLimited("upload", token.slice(0, 16))) throw forbidden("Too many uploads. Please try again later.");
    const request = await liveLink(token);
    const issue = await prisma.spaceIssue.findFirst({ where: { id: request.issueId, makerspaceId: request.makerspaceId }, select: { technicianId: true, status: true } });
    if (request.status !== "ACCEPTED" || issue?.technicianId !== request.technicianId || issue.status === "CLOSED") throw notFound("Request");
    const photo = await attachIssuePhoto({ makerspaceId: request.makerspaceId, issueId: request.issueId, actor: { kind: "LINK", technicianId: request.technicianId }, file: formData.get("file") });
    return { photoId: photo.id };
  });
}
