import "server-only";

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMakerspaceTeam } from "@/lib/permissions";
import { can, makerspaceAllows, type Capability } from "@/lib/permissionRoles";

/**
 * Who sees what on the repair pages. Staff with `issues.view` see every issue; a technician only sees the issues
 * they were asked about (anything else is not found). Amounts: finance (`repairs.pay`, bookings managers) sees
 * every amount; the technician sees only what they asked and whether it was paid; nobody else sees money.
 */
export async function repairAccess(makerspaceSlug: string) {
  const access = await requireMakerspaceTeam(makerspaceSlug);
  if (access.makerspace.status !== "ACTIVE") redirect(`/dashboard/${makerspaceSlug}/application`);
  const allowed = (capability: Capability) => makerspaceAllows(access.makerspace.status, capability) && can(access.membership.role, capability);
  const flags = {
    viewAll: allowed("issues.view"), work: allowed("repairs.work"), report: allowed("issues.report"),
    manage: allowed("repairs.manage"), pay: allowed("repairs.pay"), finance: allowed("finance.view"),
  };
  if (!flags.viewAll && !flags.work) notFound();
  const technician = flags.work ? await prisma.technician.findFirst({ where: { makerspaceId: access.makerspace.id, userId: access.userId }, select: { id: true } }) : null;
  return { ...access, flags, technicianId: technician?.id ?? null };
}
