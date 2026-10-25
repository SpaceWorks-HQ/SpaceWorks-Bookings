import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { allowed, makerspaceSummary, type RouteProps } from "@/lib/bookings/staffView";

export async function loadNewBooking({ params }: RouteProps) {
  const { makerspaceSlug } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "bookings.manage");
  const makerspaceId = access.makerspace.id;
  const spaces = await prisma.space.findMany({ where: { makerspaceId, archivedAt: null }, select: { id: true, name: true, units: true, capacity: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const addOns = await prisma.addOn.findMany({ where: { makerspaceId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, spaceId: true, priceMinor: true, unit: true } });
  return { makerspace: await makerspaceSummary(makerspaceId), spaces, addOns, canOverride: allowed(access, "bookings.override") };
}
