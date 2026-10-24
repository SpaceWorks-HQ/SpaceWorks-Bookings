import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";

/** Money and calendar preferences, and whether the calendar is already fixed by issued receipts. */
export async function loadMakerspaceMoneySettingsView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace: current } = await requireMakerspaceCapability(makerspaceSlug, "makerspace.settings");
  const makerspace = await prisma.makerspace.findUniqueOrThrow({
    where: { id: current.id },
    select: { name: true, slug: true, logoUrl: true, currency: true, locale: true, timezone: true, financialYearStartMonth: true, offlineConfirmationRequired: true, _count: { select: { taxDocuments: true } } },
  });
  const zones = Intl.supportedValuesOf("timeZone");
  return {
    makerspace,
    canEdit: true,
    calendarLocked: makerspace._count.taxDocuments > 0,
    timezones: zones.includes(makerspace.timezone) ? zones : [makerspace.timezone, ...zones],
  };
}
