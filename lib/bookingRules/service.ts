import type { Prisma } from "@prisma/client";
import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx, type Tx } from "@/lib/bookings/db";
import { invalidInput, notFound, zodInputError } from "@/lib/bookings/errors";
import { saveSetting } from "@/lib/settingsAudit";
import { applyOverridePatch, effectiveRules, parseOverrides, type EffectiveRules } from "./effective";
import { crossRuleProblems, isMoneyRule, pickRules, RULE_KEYS, RULE_SHAPE, rulesPatchSchema, type BookingRules, type RuleKey } from "./schema";

/**
 * Reading and changing booking rules. Makerspace defaults need `makerspace.settings`; per-space overrides need
 * `spaces.manage`; any money rule (MONEY_RULE_KEYS) needs `payments.settings` in either place. Every change is
 * checked as a whole (min ≤ max and so on, for the makerspace and every space it affects) and audited.
 */

export async function getMakerspaceRules(makerspaceId: string, db: DbOrTx = defaultDb()): Promise<BookingRules> {
  return pickRules((await db.makerspaceBookingSettings.findUnique({ where: { makerspaceId } })) as Record<string, unknown> | null);
}

export async function getSpaceRules(makerspaceId: string, spaceId: string, db: DbOrTx = defaultDb()): Promise<EffectiveRules> {
  const space = await db.space.findFirst({ where: { id: spaceId, makerspaceId }, select: { ruleOverrides: true } });
  if (!space) throw notFound("Space");
  return effectiveRules(await getMakerspaceRules(makerspaceId, db), space);
}

function requireForKeys(actor: Actor, keys: RuleKey[], otherCapability: "makerspace.settings" | "spaces.manage") {
  if (keys.some(isMoneyRule)) requireStaff(actor, "payments.settings");
  if (keys.some((key) => !isMoneyRule(key))) requireStaff(actor, otherCapability);
  if (keys.length === 0) requireStaff(actor, otherCapability);
}

function assertConsistent(rules: BookingRules, where?: string) {
  const problems = crossRuleProblems(rules);
  if (problems.length === 0) return;
  throw invalidInput(where ? `${where}: ${problems[0].message}` : problems[0].message, Object.fromEntries(problems.map((problem) => [problem.key, problem.message])));
}

async function assertSpacesConsistent(tx: Tx, makerspaceId: string, defaults: BookingRules, only?: { id: string; ruleOverrides: unknown }) {
  const spaces = only ? [{ name: "", ...only }] : await tx.space.findMany({ where: { makerspaceId, archivedAt: null }, select: { id: true, name: true, ruleOverrides: true } });
  for (const space of spaces) assertConsistent(effectiveRules(defaults, space).values, space.name || undefined);
}

export async function updateBookingSettings(input: { makerspaceId: string; actor: Actor; patch: unknown }, db: DbOrTx = defaultDb()): Promise<BookingRules> {
  const parsed = rulesPatchSchema.safeParse(input.patch);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  const keys = Object.keys(parsed.data) as RuleKey[];
  requireForKeys(input.actor, keys, "makerspace.settings");
  const actorUserId = input.actor.kind === "STAFF" ? input.actor.userId : null;
  return withTx(db, async (tx) => {
    const row = await tx.makerspaceBookingSettings.findUnique({ where: { makerspaceId: input.makerspaceId } });
    const before = pickRules(row as Record<string, unknown> | null);
    const after = { ...before, ...parsed.data } as BookingRules;
    assertConsistent(after);
    await assertSpacesConsistent(tx, input.makerspaceId, after);
    const data = parsed.data as Prisma.MakerspaceBookingSettingsUncheckedUpdateInput;
    await tx.makerspaceBookingSettings.upsert({ where: { makerspaceId: input.makerspaceId }, create: { ...(data as Prisma.MakerspaceBookingSettingsUncheckedCreateInput), makerspaceId: input.makerspaceId }, update: data });
    await saveSetting(tx, { area: "booking-rules", makerspaceId: input.makerspaceId, targetType: "Makerspace", targetId: input.makerspaceId, before: row ? before : null, after, actorUserId });
    return after;
  });
}

/** Patch a space's overrides: a value overrides, `null` returns the key to the makerspace default. */
export async function updateSpaceRuleOverrides(input: { makerspaceId: string; spaceId: string; actor: Actor; patch: Record<string, unknown> }, db: DbOrTx = defaultDb()): Promise<EffectiveRules> {
  const patch: Partial<Record<RuleKey, unknown>> = {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.patch ?? {})) {
    if (!RULE_KEYS.includes(key as RuleKey)) {
      fields[key] = "Unknown rule";
      continue;
    }
    if (value === null) {
      patch[key as RuleKey] = null;
      continue;
    }
    const checked = RULE_SHAPE[key as RuleKey].safeParse(value);
    if (checked.success) patch[key as RuleKey] = checked.data;
    else fields[key] = checked.error.issues[0]?.message ?? "Invalid value";
  }
  if (Object.keys(fields).length) throw invalidInput("Check the highlighted fields.", fields);
  requireForKeys(input.actor, Object.keys(patch) as RuleKey[], "spaces.manage");
  const actorUserId = input.actor.kind === "STAFF" ? input.actor.userId : null;
  return withTx(db, async (tx) => {
    const space = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId } });
    if (!space) throw notFound("Space");
    const next = applyOverridePatch(space.ruleOverrides, patch);
    const defaults = await getMakerspaceRules(input.makerspaceId, tx);
    await assertSpacesConsistent(tx, input.makerspaceId, defaults, { id: space.id, ruleOverrides: next });
    await tx.space.update({ where: { id: space.id }, data: { ruleOverrides: next as Prisma.InputJsonValue } });
    await saveSetting(tx, { area: "space-rules", makerspaceId: input.makerspaceId, targetType: "Space", targetId: space.id, before: parseOverrides(space.ruleOverrides), after: next, actorUserId });
    return effectiveRules(defaults, { ruleOverrides: next });
  });
}
