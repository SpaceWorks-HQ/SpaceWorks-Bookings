import "server-only";

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMembership, hasAuthenticator } from "@/lib/permissions";
import { can, makerspaceAllows, type Capability } from "@/lib/permissionRoles";
import { checkRateLimitById } from "@/lib/rateLimit";
import { currencyExponent, isCurrencyCode } from "@/lib/money/currencies";

/** For export routes: the signed-in staff member of this makerspace with `capability`, or a status to answer. */
export async function exportAccess(makerspaceSlug: string, capability: Capability): Promise<{ ok: true; userId: string; makerspace: { id: string; slug: string; timezone: string; financialYearStartMonth: number } } | { ok: false; status: number }> {
  const userId = (await auth())?.user?.id;
  if (!userId) return { ok: false, status: 401 };
  const makerspace = await prisma.makerspace.findUnique({ where: { slug: makerspaceSlug }, select: { id: true, slug: true, status: true, timezone: true, financialYearStartMonth: true } });
  if (!makerspace) return { ok: false, status: 404 };
  const membership = await getMembership(userId, makerspace.id);
  if (!membership || !makerspaceAllows(makerspace.status, capability) || !can(membership.role, capability)) return { ok: false, status: 404 };
  if (!(await hasAuthenticator(userId))) return { ok: false, status: 403 };
  if (!(await checkRateLimitById("reportExport", `user:${userId}`))) return { ok: false, status: 429 };
  return { ok: true, userId, makerspace };
}

/** An amount in major units of its currency, for spreadsheets (three-decimal currencies stay exact). */
export function majorUnits(minor: number, currency: string): number {
  const exponent = isCurrencyCode(currency) ? currencyExponent(currency) : 2;
  return minor / 10 ** exponent;
}
