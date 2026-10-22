import { prisma } from "@/lib/db";
import { requireOrgCapability } from "@/lib/permissions";
import { getEmailSettings } from "@/lib/instanceSettings";
import { senderAddress } from "@/lib/email/orgTransport";

/** The organisation's own email settings (never the saved password), and what is used without them. */
export async function loadOrgEmailSettingsView({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgCapability(orgSlug, "org.settings");
  const [org, settings, platform] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: organisation.id }, select: { name: true, slug: true, logoUrl: true, contactEmail: true } }),
    prisma.orgEmailSettings.findUnique({ where: { organisationId: organisation.id } }),
    getEmailSettings(),
  ]);
  return {
    org,
    canEdit: !membership.unitId,
    platformSender: senderAddress(platform.from),
    settings: {
      enabled: settings?.enabled ?? false,
      fromName: settings?.fromName ?? "",
      fromAddress: settings?.fromAddress ?? "",
      replyTo: settings?.replyTo ?? "",
      smtpHost: settings?.smtpHost ?? "",
      smtpPort: settings?.smtpPort ?? 587,
      smtpUser: settings?.smtpUser ?? "",
      hasPassword: Boolean(settings?.smtpPasswordEncrypted),
      verifiedAt: settings?.verifiedAt ?? null,
    },
  };
}
