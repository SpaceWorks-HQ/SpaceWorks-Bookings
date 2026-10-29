import { z } from "zod";
import { id, makerspaceSlug } from "./bookingInputs";

/** Inputs for the repair and finance actions; amounts arrive in minor units. */

const severity = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const amount = z.coerce.number().int().min(0).max(100_000_000);
const text = (max: number) => z.string().trim().max(max).default("");
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
// Preserve date-only text until the action resolves the makerspace timezone.
const financialDate = z.union([dateKey, z.coerce.date()]);
export const linkToken = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

export const issueScopeSchema = z.object({ makerspaceSlug, issueId: id }).strict();
export const reportIssueSchema = z.object({ makerspaceSlug, spaceId: id, title: z.string().trim().min(1, "Say what is wrong").max(120), description: text(2000), severity: severity.default("MEDIUM") }).strict();
export const customerReportSchema = reportIssueSchema.omit({ spaceId: true }).extend({ bookingId: id.optional(), manageToken: z.string().min(20).max(128).optional() })
  .refine((value) => Boolean(value.bookingId || value.manageToken), "Choose a booking");
export const sendRequestsSchema = issueScopeSchema.extend({ technicianIds: z.array(id).min(1, "Choose at least one technician").max(20) });
export const assignSchema = issueScopeSchema.extend({ technicianId: id });
export const answerSchema = issueScopeSchema.extend({ answer: z.enum(["ACCEPT", "DECLINE"]) });
export const fixSchema = issueScopeSchema.extend({ remarks: z.string().trim().min(1, "Say what you did").max(2000), partsUsed: text(1000), amountAskedMinor: amount.nullable().default(null) });
export const reopenSchema = issueScopeSchema.extend({ reason: z.string().trim().min(1, "Say why it is reopened").max(500) });
export const outOfServiceSchema = issueScopeSchema.extend({ until: dateKey.nullable() });
export const approveSchema = issueScopeSchema.extend({ amountMinor: amount, note: text(500) });
export const payoutSchema = issueScopeSchema.extend({
  amountMinor: amount.refine((value) => value > 0, "Enter the amount paid"), method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "OTHER"]),
  reference: z.string().trim().max(120).nullable().default(null), paidAt: financialDate, note: text(500),
});

export const linkAnswerSchema = z.object({ token: linkToken, answer: z.enum(["ACCEPT", "DECLINE"]) }).strict();
export const linkFixSchema = z.object({ token: linkToken, remarks: z.string().trim().min(1, "Say what you did").max(2000), partsUsed: text(1000), amountAskedMinor: amount.nullable().default(null) }).strict();

export const technicianSchema = z.object({ makerspaceSlug, fields: z.unknown() }).strict();
export const staffTechnicianSchema = z.object({ makerspaceSlug, userId: id, skills: z.array(z.string().max(60)).max(20).default([]) }).strict();
export const updateTechnicianSchema = z.object({ makerspaceSlug, technicianId: id, fields: z.unknown(), active: z.boolean() }).strict();

export const manualEntrySchema = z.object({
  makerspaceSlug, direction: z.enum(["IN", "OUT"]),
  category: z.enum(["OTHER_INCOME", "RENT", "UTILITIES", "SUPPLIES", "STAFF_COSTS", "OTHER_EXPENSE"]),
  amountMinor: amount.refine((value) => value > 0, "Enter the amount"), method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "OTHER"]),
  reference: z.string().trim().max(120).nullable().default(null), occurredAt: financialDate, note: z.string().trim().min(1, "Say what it was for").max(500),
}).strict();
export const reverseEntrySchema = z.object({ makerspaceSlug, entryId: id, reason: z.string().trim().min(1, "Say why it is reversed").max(500) }).strict();
