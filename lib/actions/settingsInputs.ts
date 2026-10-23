import { z } from "zod";
import { RULE_SHAPE, rulesPatchSchema, type RuleKey } from "@/lib/bookingRules/schema";
import { spaceFieldsSchema, weeklySchema, exceptionSchema, blackoutSchema, addOnSchema, peakSchema, tiersSchema } from "@/lib/spaces/schemas";
import { memberSchema } from "@/lib/members/schema";
import { MAX_CSV_BYTES } from "@/lib/csv";
import { id, makerspaceSlug, scopeSchema, spaceIdSchema } from "./bookingInputs";
import { hoursChoiceError } from "@/lib/spaces/hoursChoice";

const overrides = Object.fromEntries(Object.entries(RULE_SHAPE).map(([key, schema]) => [key, schema.nullable().optional()])) as {
  [K in RuleKey]: z.ZodOptional<z.ZodNullable<(typeof RULE_SHAPE)[K]>>;
};
export const bookingSettingsSchema = z.object({ makerspaceSlug, patch: rulesPatchSchema }).strict();
export const spaceRulesSchema = spaceIdSchema.extend({ patch: z.object(overrides).strict() });
export const createSpaceSchema = z.object({ makerspaceSlug, fields: spaceFieldsSchema.partial().required({ name: true }).strict() }).strict();
export const updateSpaceSchema = spaceIdSchema.extend({ fields: spaceFieldsSchema.partial().strict() });
export const archiveSpaceSchema = spaceIdSchema.extend({ archived: z.boolean() });
export const photoUploadSchema = spaceIdSchema.extend({
  file: z.custom<File>((value) => value instanceof File && value.size > 0 && value.size <= 5 * 1024 * 1024, "Choose an image of 5 MB or smaller"),
  alt: z.string().trim().max(200).default(""),
});
export const removePhotoSchema = z.object({ makerspaceSlug, photoId: id }).strict();
export const reorderPhotosSchema = spaceIdSchema.extend({ photoIds: z.array(id).max(20).refine((ids) => new Set(ids).size === ids.length, "Choose each photo once") });
export const saveAddOnSchema = scopeSchema.extend({ addOnId: id.optional(), addOn: addOnSchema.strict() });
export const removeAddOnSchema = z.object({ makerspaceSlug, addOnId: id }).strict();
export const savePeakSchema = scopeSchema.extend({ ruleId: id.optional(), rule: peakSchema });
export const removePeakSchema = z.object({ makerspaceSlug, ruleId: id }).strict();
export const refundTiersSchema = scopeSchema.extend({ tiers: tiersSchema });
export const openingHoursSchema = scopeSchema.extend({ hours: weeklySchema, openAllDay: z.boolean().optional() })
  .refine((data) => !hoursChoiceError(data.spaceId, data.hours, data.openAllDay), { path: ["hours"], message: hoursChoiceError(null, [])! });
export const hoursExceptionSchema = scopeSchema.extend({ exception: exceptionSchema.strict() });
export const removeExceptionSchema = scopeSchema.extend({ exceptionId: id });
export const createBlackoutSchema = scopeSchema.extend({ blackout: blackoutSchema });
export const removeBlackoutSchema = scopeSchema.extend({ blackoutId: id });
export const upsertMemberSchema = z.object({ makerspaceSlug, member: memberSchema.strict() }).strict();
export const removeMemberSchema = z.object({ makerspaceSlug, memberId: id }).strict();
export const importMembersSchema = z.object({ makerspaceSlug, csv: z.string().max(MAX_CSV_BYTES).refine((value) => new TextEncoder().encode(value).length <= MAX_CSV_BYTES, "The file is too large (2 MB at most)") }).strict();
