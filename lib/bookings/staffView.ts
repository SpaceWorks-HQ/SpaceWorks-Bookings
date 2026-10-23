import { prisma } from "@/lib/db";
import { can, makerspaceAllows, type Capability } from "@/lib/permissionRoles";
import type { MakerspaceAccessContext } from "@/lib/permissions";

export type RouteProps = { params: Promise<{ makerspaceSlug: string }> };
export type Search = { q?: string; page?: string; status?: string; space?: string; from?: string; to?: string; tab?: string };
export type DirectoryProps = RouteProps & { searchParams: Promise<Search> };
export const pageNumber = (value?: string) => Math.max(1, Math.min(10000, Number.parseInt(value ?? "1", 10) || 1));

export function allowed(access: MakerspaceAccessContext, capability: Capability) {
  return makerspaceAllows(access.makerspace.status, capability) && can(access.membership.role, capability);
}

export async function makerspaceSummary(id: string) {
  return prisma.makerspace.findUniqueOrThrow({ where: { id }, select: { name: true, slug: true, logoUrl: true, timezone: true, currency: true } });
}

export async function calendarData(makerspaceId: string, spaceId: string | null) {
  const where = { makerspaceId, spaceId };
  const [hours, exceptions, blackouts] = await Promise.all([
    prisma.openingHours.findMany({ where, orderBy: [{ weekday: "asc" }, { openMinute: "asc" }], select: { weekday: true, openMinute: true, closeMinute: true } }),
    prisma.hoursException.findMany({ where, orderBy: { date: "asc" }, select: { id: true, date: true, closed: true, intervals: true, reason: true } }),
    prisma.blackout.findMany({ where, orderBy: { createdAt: "desc" }, select: { id: true, startDate: true, endDate: true, startsAt: true, endsAt: true, reason: true } }),
  ]);
  return { hours, exceptions: exceptions.map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) })),
    blackouts: blackouts.map((row) => ({ ...row, startDate: row.startDate?.toISOString().slice(0, 10) ?? null, endDate: row.endDate?.toISOString().slice(0, 10) ?? null, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null })) };
}
