import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { getEmailSettings } from "@/lib/instanceSettings";
import { senderAddress } from "@/lib/email/makerspaceTransport";

/** The makerspace's own email settings (never the saved password), and what is used without them. */
export async function loadMakerspaceEmailSettingsView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace: current } = await requireMakerspaceCapability(makerspaceSlug, "makerspace.settings");
  const [makerspace, settings, platform] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({ where: { id: current.id }, select: { name: true, slug: true, logoUrl: true, contactEmail: true } }),
    prisma.makerspaceEmailSettings.findUnique({ where: { makerspaceId: current.id } }),
    getEmailSettings(),
  ]);
  return {
    makerspace,
    canEdit: true,
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
