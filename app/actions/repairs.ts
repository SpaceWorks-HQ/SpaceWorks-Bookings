"use server";

import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { staffAction } from "@/lib/actions/bookingContext";
import * as inputs from "@/lib/actions/repairInputs";
import { resolveFinancialDate } from "@/lib/actions/financialDate";
import { forbidden, notFound } from "@/lib/bookings/errors";
import { bookingDate } from "@/lib/bookings/publicUi";
import * as issues from "@/lib/repairs/issues";
import * as requests from "@/lib/repairs/requests";
import * as payouts from "@/lib/repairs/payouts";
import { attachIssuePhoto } from "@/lib/repairs/photos";

/** Staff repair actions. Every one resolves the tenant and the actor on the server; the domain checks who may act. */

const slugOf = async (makerspaceId: string) => (await prisma.makerspace.findUniqueOrThrow({ where: { id: makerspaceId }, select: { slug: true, timezone: true } }));

export async function reportIssue(input: unknown) {
  return staffAction(inputs.reportIssueSchema, input, "issues.report", async (data, ctx) => {
    if (await isActionRateLimited("create", ctx.actor.userId)) throw forbidden("Too many reports. Please try again later.");
    const issue = await issues.reportIssue({ ...ctx, ...data });
    return { issueId: issue.id, reference: issue.reference };
  });
}

export async function sendRepairRequests(input: unknown) {
  return staffAction(inputs.sendRequestsSchema, input, "repairs.manage", async (data, ctx) => (
    requests.sendRequests({ ...ctx, makerspaceSlug: data.makerspaceSlug, issueId: data.issueId, technicianIds: data.technicianIds })));
}

export async function assignTechnician(input: unknown) {
  return staffAction(inputs.assignSchema, input, "repairs.manage", (data, ctx) => issues.assignTechnician({ ...ctx, makerspaceSlug: data.makerspaceSlug, issueId: data.issueId, technicianId: data.technicianId }));
}

export async function answerRepairRequest(input: unknown) {
  return staffAction(inputs.answerSchema, input, "repairs.work", (data, ctx) => requests.answerAsStaff({ ...ctx, issueId: data.issueId, answer: data.answer }));
}

/** The assigned staff technician records the work; a bookings manager may record it on their behalf. */
export async function recordRepairFix(input: unknown) {
  return staffAction(inputs.fixSchema, input, "issues.report", (data, ctx) => issues.recordFix({ ...ctx, issueId: data.issueId, remarks: data.remarks, partsUsed: data.partsUsed, amountAskedMinor: data.amountAskedMinor }));
}

export async function closeIssue(input: unknown) {
  return staffAction(inputs.issueScopeSchema, input, "repairs.manage", (data, ctx) => issues.closeIssue({ ...ctx, issueId: data.issueId }));
}

export async function reopenIssue(input: unknown) {
  return staffAction(inputs.reopenSchema, input, "repairs.manage", (data, ctx) => issues.reopenIssue({ ...ctx, issueId: data.issueId, reason: data.reason }));
}

export async function setOutOfService(input: unknown) {
  return staffAction(inputs.outOfServiceSchema, input, "repairs.manage", async (data, ctx) => {
    const { timezone } = await slugOf(ctx.makerspaceId);
    return issues.setOutOfService({ ...ctx, issueId: data.issueId, today: bookingDate(new Date(), timezone), until: data.until });
  });
}

export async function approveRepairAmount(input: unknown) {
  return staffAction(inputs.approveSchema, input, "repairs.pay", (data, ctx) => payouts.approveRepairAmount({ ...ctx, issueId: data.issueId, amountMinor: data.amountMinor, note: data.note }));
}

export async function recordRepairPayout(input: unknown) {
  return staffAction(inputs.payoutSchema, input, "repairs.pay", async (data, ctx) => {
    const { timezone } = await slugOf(ctx.makerspaceId);
    return payouts.recordRepairPayout({ ...ctx, ...data, paidAt: resolveFinancialDate(data.paidAt, timezone) });
  });
}

/** Staff add photos to an issue they can see: the reporter side, a manager, or the technician holding it. */
export async function addIssuePhoto(formData: FormData) {
  return staffAction(inputs.issueScopeSchema, { makerspaceSlug: formData.get("makerspaceSlug"), issueId: formData.get("issueId") }, "issues.report", async (data, ctx) => {
    if (await isActionRateLimited("upload", ctx.actor.userId)) throw forbidden("Too many uploads. Please try again later.");
    if (ctx.actor.role === "TECHNICIAN" && !(await requests.technicianCanSee(ctx.makerspaceId, data.issueId, ctx.actor.userId))) throw notFound("Issue");
    const photo = await attachIssuePhoto({ ...ctx, issueId: data.issueId, file: formData.get("file") });
    return { photoId: photo.id };
  });
}
