import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { effectiveRules } from "@/lib/bookingRules/effective";
import { pickRules } from "@/lib/bookingRules/schema";
import { allowed, calendarData, makerspaceSummary } from "@/lib/bookings/staffView";

export async function loadSpace({ params, searchParams }: {
  params: Promise<{ makerspaceSlug: string; spaceId: string }>; searchParams: Promise<{ tab?: string }>;
}) {
  const { makerspaceSlug, spaceId } = await params;
  const access = await requireMakerspaceCapability(makerspaceSlug, "spaces.manage");
  const makerspaceId = access.makerspace.id;
  const space = await prisma.space.findFirst({ where: { id: spaceId, makerspaceId }, include: {
    photos: { where: { makerspaceId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, url: true, alt: true } },
    addOns: { where: { makerspaceId, active: true }, orderBy: { sortOrder: "asc" } },
    peakRules: { where: { makerspaceId }, orderBy: { name: "asc" } }, refundTiers: { where: { makerspaceId }, orderBy: { minHoursBefore: "desc" } },
  } });
  if (!space) notFound();
  const defaults = pickRules(await prisma.makerspaceBookingSettings.findUnique({ where: { makerspaceId } }));
  const tab = (await searchParams).tab ?? "details";
  return { makerspace: await makerspaceSummary(makerspaceId), space: { ...space, archivedAt: space.archivedAt?.toISOString() ?? null,
    createdAt: space.createdAt.toISOString(), updatedAt: space.updatedAt.toISOString(),
    addOns: space.addOns.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) },
    defaults, rules: effectiveRules(defaults, space), canMoney: allowed(access, "payments.settings"),
    calendar: await calendarData(makerspaceId, spaceId), inherited: await calendarData(makerspaceId, null),
    defaultTiers: await prisma.refundTier.findMany({ where: { makerspaceId, spaceId: null }, select: { minHoursBefore: true, refundBps: true }, orderBy: { minHoursBefore: "desc" } }), tab,
  };
}
