import { z } from "zod";
import { parseDateKey } from "@/lib/time/zoned";

const money = z.number().int().min(0).max(1_000_000_000).nullable();
export const spaceFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  slug: z.string().trim().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens"),
  kind: z.enum(["ROOM", "STUDIO", "DESK", "HALL", "OTHER"]),
  summary: z.string().trim().max(300),
  description: z.string().max(10_000),
  capacity: z.number().int().min(0).max(100_000),
  units: z.number().int().min(1).max(500),
  amenities: z.array(z.string().trim().min(1).max(60)).max(30),
  colour: z.string().regex(/^[a-z-]{1,30}$/).nullable(),
  published: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  publicHourlyMinor: money,
  publicHalfDayMinor: money,
  publicDayMinor: money,
  memberHourlyMinor: money,
  memberHalfDayMinor: money,
  memberDayMinor: money,
  halfDayMinutes: z.number().int().min(15).max(1440),
  dayMinutes: z.number().int().min(15).max(1440),
  taxRateBps: z.number().int().min(0).max(10_000).nullable(),
  sacCode: z.string().regex(/^[0-9]{4,8}$/, "A SAC is 4 to 8 digits").nullable(),
});
export type SpaceFields = z.infer<typeof spaceFieldsSchema>;

const interval = z.object({ openMinute: z.number().int().min(0).max(1439), closeMinute: z.number().int().min(1).max(1440) }).refine((value) => value.openMinute < value.closeMinute, "Closing must be after opening");
export const weeklySchema = z.array(interval.and(z.object({ weekday: z.number().int().min(0).max(6) }))).max(7 * 24);

export const exceptionSchema = z.object({
  date: z.string().refine((value) => parseDateKey(value) !== null, "Choose a date"),
  closed: z.boolean(),
  intervals: z.array(interval).max(24).default([]),
  reason: z.string().trim().max(200).default(""),
});

export const blackoutSchema = z.union([
  z.object({ startDate: z.string().refine((value) => parseDateKey(value) !== null, "Choose a date"), endDate: z.string().refine((value) => parseDateKey(value) !== null, "Choose a date"), reason: z.string().trim().max(200).default("") }),
  z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date(), reason: z.string().trim().max(200).default("") }),
]);

export const peakSchema = z
  .object({
    name: z.string().trim().min(1, "Name the rule").max(80),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one day").max(7).transform((days) => [...new Set(days)].sort()),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    surchargeBps: z.number().int().min(1).max(100_000),
    active: z.boolean().default(true),
  })
  .refine((value) => value.startMinute < value.endMinute, { message: "The end must be after the start", path: ["endMinute"] });

export const addOnSchema = z.object({
  name: z.string().trim().min(1, "Name the extra").max(120),
  description: z.string().trim().max(500).default(""),
  unit: z.enum(["PER_BOOKING", "PER_HOUR", "PER_PERSON"]),
  priceMinor: z.number().int().min(0).max(1_000_000_000),
  memberPriceMinor: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  sacCode: z.string().regex(/^[0-9]{4,8}$/, "A SAC is 4 to 8 digits").nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export const tiersSchema = z
  .array(z.object({ minHoursBefore: z.number().int().min(0).max(8760), refundBps: z.number().int().min(0).max(10_000) }))
  .max(10)
  .refine((tiers) => new Set(tiers.map((tier) => tier.minHoursBefore)).size === tiers.length, "Each tier needs its own number of hours");
