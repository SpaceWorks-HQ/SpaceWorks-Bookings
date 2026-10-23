import type { AddOn, PeakRule } from "@prisma/client";
import { z } from "zod";
import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx, type Tx } from "@/lib/bookings/db";
import { invalidInput, notFound, zodInputError } from "@/lib/bookings/errors";
import { saveSetting } from "@/lib/settingsAudit";

/**
 * Pricing extras: peak rules and add-ons (`spaces.manage`), and the refund policy tiers (`payments.settings`).
 * spaceId null = the whole makerspace. Every change is audited.
 */

const actorId = (actor: Actor) => (actor.kind === "STAFF" ? actor.userId : null);

async function assertSpace(tx: Tx, makerspaceId: string, spaceId: string | null | undefined) {
  if (spaceId && !(await tx.space.findFirst({ where: { id: spaceId, makerspaceId }, select: { id: true } }))) throw notFound("Space");
}

// ---------- peak rules ----------

const peakSchema = z
  .object({
    name: z.string().trim().min(1, "Name the rule").max(80),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one day").max(7).transform((days) => [...new Set(days)].sort()),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    surchargeBps: z.number().int().min(1).max(100_000),
    active: z.boolean().default(true),
  })
  .refine((value) => value.startMinute < value.endMinute, { message: "The end must be after the start", path: ["endMinute"] });
const peakView = (row: PeakRule | null) => (row ? { name: row.name, weekdays: row.weekdays, startMinute: row.startMinute, endMinute: row.endMinute, surchargeBps: row.surchargeBps, active: row.active, spaceId: row.spaceId } : null);

export async function savePeakRule(input: { makerspaceId: string; actor: Actor; ruleId?: string; spaceId?: string | null; rule: unknown }, db: DbOrTx = defaultDb()): Promise<PeakRule> {
  requireStaff(input.actor, "spaces.manage");
  const parsed = peakSchema.safeParse(input.rule);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  return withTx(db, async (tx) => {
    const before = input.ruleId ? await tx.peakRule.findFirst({ where: { id: input.ruleId, makerspaceId: input.makerspaceId } }) : null;
    if (input.ruleId && !before) throw notFound("Peak rule");
    const spaceId = before ? before.spaceId : (input.spaceId ?? null);
    await assertSpace(tx, input.makerspaceId, spaceId);
    const rule = before ? await tx.peakRule.update({ where: { id: before.id }, data: parsed.data }) : await tx.peakRule.create({ data: { ...parsed.data, makerspaceId: input.makerspaceId, spaceId } });
    await saveSetting(tx, { area: "peak-rule", makerspaceId: input.makerspaceId, targetType: "PeakRule", targetId: rule.id, before: peakView(before), after: peakView(rule), actorUserId: actorId(input.actor) });
    return rule;
  });
}

export async function removePeakRule(input: { makerspaceId: string; actor: Actor; ruleId: string }, db: DbOrTx = defaultDb()): Promise<void> {
  requireStaff(input.actor, "spaces.manage");
  await withTx(db, async (tx) => {
    const before = await tx.peakRule.findFirst({ where: { id: input.ruleId, makerspaceId: input.makerspaceId } });
    if (!before) throw notFound("Peak rule");
    await tx.peakRule.delete({ where: { id: before.id } });
    await saveSetting(tx, { area: "peak-rule", makerspaceId: input.makerspaceId, targetType: "PeakRule", targetId: before.id, before: peakView(before), after: null, actorUserId: actorId(input.actor) });
  });
}

// ---------- add-ons ----------

const addOnSchema = z.object({
  name: z.string().trim().min(1, "Name the extra").max(120),
  description: z.string().trim().max(500).default(""),
  unit: z.enum(["PER_BOOKING", "PER_HOUR", "PER_PERSON"]),
  priceMinor: z.number().int().min(0).max(1_000_000_000),
  memberPriceMinor: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  sacCode: z.string().regex(/^[0-9]{4,8}$/, "A SAC is 4 to 8 digits").nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
const addOnView = (row: AddOn | null) => (row ? { name: row.name, description: row.description, unit: row.unit, priceMinor: row.priceMinor, memberPriceMinor: row.memberPriceMinor, sacCode: row.sacCode, active: row.active, sortOrder: row.sortOrder, spaceId: row.spaceId } : null);

/** Create or update an add-on. Retire one with `active: false` (bookings keep their frozen lines). */
export async function saveAddOn(input: { makerspaceId: string; actor: Actor; addOnId?: string; spaceId?: string | null; addOn: unknown }, db: DbOrTx = defaultDb()): Promise<AddOn> {
  requireStaff(input.actor, "spaces.manage");
  const parsed = addOnSchema.safeParse(input.addOn);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  if (parsed.data.memberPriceMinor != null && parsed.data.memberPriceMinor > parsed.data.priceMinor) throw invalidInput("The member price can't be above the public price.", { memberPriceMinor: "At most the public price" });
  if (parsed.data.sacCode) requireStaff(input.actor, "payments.settings");
  return withTx(db, async (tx) => {
    const before = input.addOnId ? await tx.addOn.findFirst({ where: { id: input.addOnId, makerspaceId: input.makerspaceId } }) : null;
    if (input.addOnId && !before) throw notFound("Add-on");
    const spaceId = before ? before.spaceId : (input.spaceId ?? null);
    await assertSpace(tx, input.makerspaceId, spaceId);
    const addOn = before ? await tx.addOn.update({ where: { id: before.id }, data: parsed.data }) : await tx.addOn.create({ data: { ...parsed.data, makerspaceId: input.makerspaceId, spaceId } });
    await saveSetting(tx, { area: "add-on", makerspaceId: input.makerspaceId, targetType: "AddOn", targetId: addOn.id, before: addOnView(before), after: addOnView(addOn), actorUserId: actorId(input.actor) });
    return addOn;
  });
}

// ---------- refund tiers ----------

const tiersSchema = z
  .array(z.object({ minHoursBefore: z.number().int().min(0).max(8760), refundBps: z.number().int().min(0).max(10_000) }))
  .max(10)
  .refine((tiers) => new Set(tiers.map((tier) => tier.minHoursBefore)).size === tiers.length, "Each tier needs its own number of hours");

/**
 * Replace the refund tiers of the makerspace (spaceId null) or one space (empty = inherit the makerspace's).
 * Cancelling earlier must never refund less, so refunds can only grow with the hours.
 */
export async function replaceRefundTiers(input: { makerspaceId: string; actor: Actor; spaceId: string | null; tiers: unknown }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "payments.settings");
  const parsed = tiersSchema.safeParse(input.tiers);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  const tiers = [...parsed.data].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].refundBps > tiers[index - 1].refundBps) throw invalidInput("Cancelling earlier must refund at least as much as cancelling later.");
  }
  return withTx(db, async (tx) => {
    await assertSpace(tx, input.makerspaceId, input.spaceId);
    const where = { makerspaceId: input.makerspaceId, spaceId: input.spaceId };
    const before = (await tx.refundTier.findMany({ where })).map(({ minHoursBefore, refundBps }) => ({ minHoursBefore, refundBps })).sort((a, b) => b.minHoursBefore - a.minHoursBefore);
    await tx.refundTier.deleteMany({ where });
    if (tiers.length) await tx.refundTier.createMany({ data: tiers.map((tier) => ({ ...tier, ...where })) });
    await saveSetting(tx, { area: "refund-tiers", makerspaceId: input.makerspaceId, targetType: input.spaceId ? "Space" : "Makerspace", targetId: input.spaceId ?? input.makerspaceId, before: { tiers: before }, after: { tiers }, actorUserId: actorId(input.actor) });
    return tiers;
  });
}
