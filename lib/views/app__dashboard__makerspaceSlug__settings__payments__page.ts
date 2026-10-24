import { prisma } from "@/lib/db";
import { can, requireMakerspaceCapability } from "@/lib/permissions";
import { getRequestOrigin } from "@/lib/publicUrl";
import { ensurePaymentSettings, webhookPath } from "@/lib/payments/config";
import { paymentSecretsConfigured } from "@/lib/payments/secrets";

/** Gateway, tax and offline payment settings. Secrets never leave the server; only whether one is saved. */
export async function loadPaymentSettingsView({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const { makerspace: current, membership } = await requireMakerspaceCapability(makerspaceSlug, "payments.view");
  const [makerspace, settings, tax, origin] = await Promise.all([
    prisma.makerspace.findUniqueOrThrow({ where: { id: current.id }, select: { name: true, slug: true, logoUrl: true, stateCode: true, currency: true } }),
    ensurePaymentSettings(current.id),
    prisma.makerspaceTaxSettings.findUnique({ where: { makerspaceId: current.id } }),
    getRequestOrigin(),
  ]);
  const canEdit = can(membership.role, "payments.settings");
  return {
    makerspace,
    canEdit,
    secretsReady: paymentSecretsConfigured(),
    gateway: {
      provider: settings.provider,
      keyId: settings.keyId,
      hasSecret: Boolean(settings.secretEncrypted),
      hasWebhookSecret: Boolean(settings.webhookSecretEncrypted),
      testMode: settings.testMode,
      verifiedAt: settings.verifiedAt,
      webhookUrls: canEdit ? { RAZORPAY: `${origin}${webhookPath("RAZORPAY", settings.webhookPublicCode)}`, STRIPE: `${origin}${webhookPath("STRIPE", settings.webhookPublicCode)}` } : null,
    },
    offline: { upiVpa: settings.upiVpa ?? "", upiPayeeName: settings.upiPayeeName ?? "", offlineInstructions: settings.offlineInstructions },
    tax: {
      mode: tax?.mode ?? "NONE",
      scheme: tax?.scheme ?? "REGULAR",
      gstin: tax?.gstin ?? "",
      legalName: tax?.legalName ?? makerspace.name,
      address: tax?.address ?? "",
      stateCode: tax?.stateCode ?? makerspace.stateCode ?? "",
      sacCode: tax?.sacCode ?? "997212",
      rateBps: tax?.rateBps ?? 1800,
      inclusive: tax?.inclusive ?? true,
      exempt: tax?.exempt ?? false,
      foreignCurrencyTax: tax?.foreignCurrencyTax ?? "NO_TAX",
      lutNumber: tax?.lutNumber ?? "",
      simpleTaxName: tax?.simpleTaxName ?? "Tax",
      receiptPrefix: tax?.receiptPrefix ?? "",
    },
  };
}
