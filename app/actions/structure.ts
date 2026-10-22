"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { orgActionAccess } from "@/lib/permissions";
import { isCurrencyCode } from "@/lib/money/currencies";
import { memberRoleSchema, unitLevelsSchema, unitSchema } from "@/lib/membership/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

const ORG_WIDE_ONLY = "Only owners and managers for the whole organisation can change its structure.";
const MAX_UNITS = 2000;

function isUnique(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function settingsAccess(slug: unknown) {
  const access = await orgActionAccess(slug, "org.settings");
  if (!access.ok) return access;
  if (access.membership.unitId) return { ok: false as const, error: ORG_WIDE_ONLY };
  if (await isActionRateLimited("action", access.userId)) return { ok: false as const, error: "Too many requests. Try again shortly." };
  return access;
}

function refresh(slug: string) {
  revalidatePath(`/dashboard/${slug}/settings`, "layout");
  revalidatePath(`/dashboard/${slug}/members`);
}

/** Name the levels the organisation uses, top first (for example Region, District, Chapter). */
export async function setUnitLevels(input: unknown): Promise<ActionResult> {
  const parsed = unitLevelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Level names are 2 to 40 characters, at most four levels.", fieldErrors: flattenZodErrors(parsed.error) };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  const deepest = await prisma.orgUnit.aggregate({ where: { organisationId: access.organisation.id, archivedAt: null }, _max: { level: true } });
  if (deepest._max.level !== null && deepest._max.level >= parsed.data.levels.length) {
    return { ok: false, error: "Some units sit deeper than the levels you kept. Archive or move them first." };
  }
  await prisma.organisation.update({ where: { id: access.organisation.id }, data: { unitLevels: parsed.data.levels } });
  await recordAuditEvent({ action: "UNIT_LEVELS_CHANGED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "Organisation", targetId: access.organisation.id });
  refresh(access.organisation.slug);
  return { ok: true };
}

/** Add a unit under a parent (or at the top). Its depth must have a level name. */
export async function createUnit(input: unknown): Promise<ActionResult<{ unitId: string }>> {
  const parsed = unitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: access.organisation.id }, select: { unitLevels: true } });
  const parent = parsed.data.parentId
    ? await prisma.orgUnit.findFirst({ where: { organisationId: access.organisation.id, id: parsed.data.parentId, archivedAt: null }, select: { id: true, level: true, path: true } })
    : null;
  if (parsed.data.parentId && !parent) return { ok: false, error: "The parent unit no longer exists." };
  const level = parent ? parent.level + 1 : 0;
  if (level >= Math.max(org.unitLevels.length, 1)) return { ok: false, error: "Name a deeper level first under Levels." };
  if ((await prisma.orgUnit.count({ where: { organisationId: access.organisation.id } })) >= MAX_UNITS) return { ok: false, error: "This organisation has reached the unit limit." };
  try {
    const unit = await prisma.$transaction(async (tx) => {
      const created = await tx.orgUnit.create({
        data: { organisationId: access.organisation.id, parentId: parent?.id ?? null, name: parsed.data.name, slug: parsed.data.slug, level, path: "pending" },
      });
      const path = parent ? `${parent.path}/${created.id}` : created.id;
      await tx.orgUnit.update({ where: { id: created.id }, data: { path } });
      await recordAuditEvent({ action: "UNIT_CREATED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "OrgUnit", targetId: created.id, client: tx });
      return created;
    });
    refresh(access.organisation.slug);
    return { ok: true, data: { unitId: unit.id } };
  } catch (error) {
    if (isUnique(error)) return { ok: false, error: "Another unit already uses that short name.", fieldErrors: { slug: ["Already used"] } };
    throw error;
  }
}

const renameSchema = z.object({ organisationSlug: z.string().trim().min(1), unitId: z.string().trim().min(1).max(64), name: z.string().trim().min(2).max(80) });

export async function renameUnit(input: unknown): Promise<ActionResult> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Names are 2 to 80 characters." };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  const updated = await prisma.orgUnit.updateMany({ where: { id: parsed.data.unitId, organisationId: access.organisation.id }, data: { name: parsed.data.name } });
  if (updated.count !== 1) return { ok: false, error: "Unit not found." };
  refresh(access.organisation.slug);
  return { ok: true };
}

const archiveSchema = z.object({ organisationSlug: z.string().trim().min(1), unitId: z.string().trim().min(1).max(64), archived: z.boolean() });

/** Archive a unit and everything under it. Members keep their unit for history; new members can't pick it. */
export async function setUnitArchived(input: unknown): Promise<ActionResult> {
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  const unit = await prisma.orgUnit.findFirst({ where: { id: parsed.data.unitId, organisationId: access.organisation.id }, select: { path: true } });
  if (!unit) return { ok: false, error: "Unit not found." };
  await prisma.orgUnit.updateMany({
    where: { organisationId: access.organisation.id, OR: [{ path: unit.path }, { path: { startsWith: `${unit.path}/` } }] },
    data: { archivedAt: parsed.data.archived ? new Date() : null },
  });
  await recordAuditEvent({ action: parsed.data.archived ? "UNIT_ARCHIVED" : "UNIT_RESTORED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "OrgUnit", targetId: parsed.data.unitId });
  refresh(access.organisation.slug);
  return { ok: true };
}

export async function createMemberRole(input: unknown): Promise<ActionResult<{ roleId: string }>> {
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  if (parsed.data.unitId && !(await prisma.orgUnit.count({ where: { id: parsed.data.unitId, organisationId: access.organisation.id } }))) return { ok: false, error: "That unit no longer exists." };
  try {
    const count = await prisma.memberRole.count({ where: { organisationId: access.organisation.id } });
    const role = await prisma.memberRole.create({
      data: { organisationId: access.organisation.id, name: parsed.data.name, description: parsed.data.description, color: parsed.data.color, unitId: parsed.data.unitId ?? null, sortOrder: count },
    });
    await recordAuditEvent({ action: "MEMBER_ROLE_CREATED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "MemberRole", targetId: role.id });
    refresh(access.organisation.slug);
    return { ok: true, data: { roleId: role.id } };
  } catch (error) {
    if (isUnique(error)) return { ok: false, error: "A role with that name exists.", fieldErrors: { name: ["Already exists"] } };
    throw error;
  }
}

const updateRoleSchema = memberRoleSchema.extend({ roleId: z.string().trim().min(1).max(64), archived: z.boolean().default(false) });

export async function updateMemberRole(input: unknown): Promise<ActionResult> {
  const parsed = updateRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  try {
    const updated = await prisma.memberRole.updateMany({
      where: { id: parsed.data.roleId, organisationId: access.organisation.id },
      data: { name: parsed.data.name, description: parsed.data.description, color: parsed.data.color, unitId: parsed.data.unitId ?? null, archivedAt: parsed.data.archived ? new Date() : null },
    });
    if (updated.count !== 1) return { ok: false, error: "Role not found." };
  } catch (error) {
    if (isUnique(error)) return { ok: false, error: "A role with that name exists.", fieldErrors: { name: ["Already exists"] } };
    throw error;
  }
  refresh(access.organisation.slug);
  return { ok: true };
}

const TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

const preferencesSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  currency: z.string().refine(isCurrencyCode, "Choose a currency"),
  locale: z.string().trim().max(20).optional().transform((value) => value || null).refine((value) => {
    if (!value) return true;
    try {
      return Intl.NumberFormat.supportedLocalesOf([value]).length === 1;
    } catch {
      return false;
    }
  }, "Unknown locale"),
  timezone: z.string().refine((value) => TIMEZONES.has(value) || value === "UTC", "Choose a timezone"),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  offlineConfirmationRequired: z.boolean(),
});

/**
 * Money and calendar preferences. The financial year and timezone can change only before the first
 * membership, because terms and receipt numbering already depend on them.
 */
export async function updateOrganisationPreferences(input: unknown): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const access = await settingsAccess(parsed.data.organisationSlug);
  if (!access.ok) return access;
  const current = await prisma.organisation.findUniqueOrThrow({ where: { id: access.organisation.id }, select: { timezone: true, financialYearStartMonth: true, _count: { select: { terms: true } } } });
  const calendarChanged = current.timezone !== parsed.data.timezone || current.financialYearStartMonth !== parsed.data.financialYearStartMonth;
  if (calendarChanged && current._count.terms > 0) {
    return { ok: false, error: "The financial year and timezone are fixed once memberships exist." };
  }
  await prisma.organisation.update({
    where: { id: access.organisation.id },
    data: {
      currency: parsed.data.currency,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
      financialYearStartMonth: parsed.data.financialYearStartMonth,
      offlineConfirmationRequired: parsed.data.offlineConfirmationRequired,
    },
  });
  await recordAuditEvent({ action: "ORGANISATION_PREFERENCES_UPDATED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "Organisation", targetId: access.organisation.id });
  refresh(access.organisation.slug);
  return { ok: true };
}
