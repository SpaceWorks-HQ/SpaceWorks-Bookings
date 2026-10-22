"use server";

import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { orgActionAccess } from "@/lib/permissions";
import { isCurrencyCode } from "@/lib/money/currencies";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
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
 * Money and calendar preferences. The financial year and timezone can change only before the first receipt,
 * because receipt numbering already depends on them. The audit row keeps the values before and after.
 */
export async function updateOrganisationPreferences(input: unknown): Promise<ActionResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const { organisationSlug, ...data } = parsed.data;
  const access = await orgActionAccess(organisationSlug, "org.settings");
  if (!access.ok) return access;
  if (await isActionRateLimited("action", access.userId)) return { ok: false, error: "Too many requests. Try again shortly." };
  const before = await prisma.organisation.findUniqueOrThrow({
    where: { id: access.organisation.id },
    select: { currency: true, locale: true, timezone: true, financialYearStartMonth: true, offlineConfirmationRequired: true, _count: { select: { taxDocuments: true } } },
  });
  const calendarChanged = before.timezone !== data.timezone || before.financialYearStartMonth !== data.financialYearStartMonth;
  if (calendarChanged && before._count.taxDocuments > 0) return { ok: false, error: "The financial year and timezone are fixed once receipts exist." };
  await prisma.organisation.update({ where: { id: access.organisation.id }, data });
  const previous = { currency: before.currency, locale: before.locale, timezone: before.timezone, financialYearStartMonth: before.financialYearStartMonth, offlineConfirmationRequired: before.offlineConfirmationRequired };
  await recordAuditEvent({ action: "ORGANISATION_PREFERENCES_UPDATED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "Organisation", targetId: access.organisation.id, metadata: { before: JSON.stringify(previous), after: JSON.stringify(data) } });
  revalidatePath(`/dashboard/${access.organisation.slug}/settings`, "layout");
  return { ok: true };
}
