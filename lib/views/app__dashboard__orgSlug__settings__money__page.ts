import { prisma } from "@/lib/db";
import { requireOrgCapability } from "@/lib/permissions";

/** Money and calendar preferences, and whether the calendar is already fixed by issued receipts. */
export async function loadOrgMoneySettingsView({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation } = await requireOrgCapability(orgSlug, "org.settings");
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: organisation.id },
    select: { name: true, slug: true, logoUrl: true, currency: true, locale: true, timezone: true, financialYearStartMonth: true, offlineConfirmationRequired: true, _count: { select: { taxDocuments: true } } },
  });
  const zones = Intl.supportedValuesOf("timeZone");
  return {
    org,
    canEdit: true,
    calendarLocked: org._count.taxDocuments > 0,
    timezones: zones.includes(org.timezone) ? zones : [org.timezone, ...zones],
  };
}
