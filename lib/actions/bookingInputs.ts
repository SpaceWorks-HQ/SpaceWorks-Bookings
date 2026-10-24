import { z } from "zod";
import { parseDateKey } from "@/lib/time/zoned";
import { advanceCap, MAX_BOOKING_MINUTES } from "@/lib/bookings/inputBounds";

export const id = z.string().trim().min(1).max(128);
export const makerspaceSlug = z.string().trim().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const scopeSchema = z.object({ makerspaceSlug, spaceId: id.nullable().default(null) }).strict();
export const slugSchema = z.object({ makerspaceSlug }).strict();
export const spaceIdSchema = z.object({ makerspaceSlug, spaceId: id }).strict();
export const localDate = z.string().refine((value) => parseDateKey(value) !== null, "Use a YYYY-MM-DD date");
export const instant = z.union([z.date(), z.iso.datetime({ offset: true }).transform((value) => new Date(value))])
  .refine((value) => value <= advanceCap(), "Choose a time at most two years ahead");
export const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email").max(320));
export const reason = z.string().trim().min(1, "Enter a reason").max(1000);
export const overrideReason = reason.nullable().optional();
export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  email,
  phone: z.string().trim().max(40).nullable().optional(),
}).strict();
export const recurrenceSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY"]),
  interval: z.number().int().min(1).max(12).optional(),
  count: z.number().int().min(1).max(104).optional(),
  until: localDate.refine((value) => value <= advanceCap().toISOString().slice(0, 10), "End the series within two years").optional(),
}).strict().refine((value) => value.count != null || value.until != null, "Choose a count or an end date");
const boundedSlot = (value: { start: Date; end: Date }) => value.end > value.start && value.end.getTime() - value.start.getTime() <= MAX_BOOKING_MINUTES * 60_000;
const slotError = { path: ["end"], message: "The end must be after the start and within seven days" };
export const slotSchema = z.object({ start: instant, end: instant }).strict().refine(boundedSlot, slotError);
const quantity = z.number().int().min(1).max(500).default(1);
export const addOnSelections = z.array(z.object({ addOnId: id, quantity: z.number().int().min(1).max(100) }).strict()).max(50)
  .refine((items) => new Set(items.map((item) => item.addOnId)).size === items.length, "Choose each add-on once");
export const holdSchema = z.object({
  makerspaceSlug, spaceId: id, start: instant, end: instant, quantity,
  recurrence: recurrenceSchema.nullable().optional(), skipConflicts: z.boolean().optional(),
}).strict().refine(boundedSlot, slotError);
export const staffHoldSchema = holdSchema.safeExtend({ overrideReason, contact: contactSchema.optional() });
export const bookingIdSchema = z.object({ makerspaceSlug, bookingId: id }).strict();
export const token = z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const releaseHoldSchema = bookingIdSchema.extend({ manageToken: token });
export const quoteSchema = holdSchema.safeExtend({ bookingId: id.optional(), manageToken: token.optional(), attendees: z.number().int().min(1).max(100_000).default(1), addOns: addOnSelections.default([]) });
export const submitSchema = bookingIdSchema.extend({
  manageToken: token.optional(), contact: contactSchema,
  attendees: z.number().int().min(1).max(100_000), addOns: addOnSelections.default([]),
  purpose: z.string().trim().max(2000).optional(), payLater: z.boolean().optional(),
});
export const staffSubmitSchema = submitSchema.omit({ manageToken: true }).extend({
  internalNotes: z.string().trim().max(4000).optional(), applyMemberRate: z.boolean().optional(),
});
export const cancelScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL") }).strict(),
  z.object({ type: z.literal("OCCURRENCE"), occurrenceId: id }).strict(),
  z.object({ type: z.literal("FOLLOWING"), occurrenceId: id }).strict(),
]);
export const cancelSchema = bookingIdSchema.extend({ scope: cancelScopeSchema.optional(), reason: z.string().trim().max(1000).optional() });
export const staffCancelSchema = cancelSchema.extend({ kind: z.enum(["STAFF", "VENUE"]).default("STAFF") })
  .refine((value) => value.kind !== "VENUE" || Boolean(value.reason), { path: ["reason"], message: "Say why the venue is cancelling" });
const rescheduleBase = bookingIdSchema.extend({ occurrenceId: id, start: instant, end: instant });
export const rescheduleSchema = rescheduleBase.refine(boundedSlot, slotError);
export const staffRescheduleSchema = rescheduleSchema.safeExtend({ overrideReason });
export const approveSchema = bookingIdSchema.extend({ overrideReason });
export const declineSchema = bookingIdSchema.extend({ reason });
export const moveSchema = bookingIdSchema.extend({ toSpaceId: id, overrideReason });
export const occurrenceSchema = z.object({ makerspaceSlug, occurrenceId: id }).strict();
export const checkInSchema = z.object({ makerspaceSlug, bookingId: id.optional(), occurrenceId: id.optional() }).strict()
  .refine((value) => Boolean(value.bookingId || value.occurrenceId), "Choose a booking or occurrence");
export const checkInCodeSchema = z.object({ makerspaceSlug, code: z.string().trim().min(1).max(64) }).strict();
export const selfCheckInSchema = z.object({ makerspaceSlug, bookingId: id.optional(), manageToken: token.optional() }).strict()
  .refine((value) => Boolean(value.bookingId || value.manageToken), "Choose a booking");
export const manageLinkSchema = z.object({ makerspaceSlug, reference: z.string().trim().max(32).default(""), email }).strict();
export const tokenCancelSchema = cancelSchema.omit({ bookingId: true }).extend({ manageToken: token });
export const tokenRescheduleSchema = rescheduleBase.omit({ bookingId: true }).extend({ manageToken: token }).refine(boundedSlot, slotError);
