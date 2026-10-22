import type { Metadata } from "next";
import { loadPaymentSettingsView } from "@/lib/views/app__dashboard__orgSlug__settings__payments__page";
import { formatCalendarDate, localDate } from "@/lib/membership/periods";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { GatewaySettingsForm } from "@/components/settings/payments/GatewaySettingsForm";
import { OfflinePaymentsForm } from "@/components/settings/payments/OfflinePaymentsForm";
import { RefundPolicyForm } from "@/components/settings/payments/RefundPolicyForm";
import { TaxSettingsForm } from "@/components/settings/payments/TaxSettingsForm";
import { Card, CardHeader } from "@/components/ui/display";

export const metadata: Metadata = { title: "Payments and tax", robots: { index: false, follow: false } };

export default async function PaymentSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { org, canEdit, secretsReady, gateway, offline, refunds, tax } = await loadPaymentSettingsView({ params });
  return (
    <div className="flex flex-col gap-6">
      <OrgPageHeader organisation={org} title="Settings" description="How members pay, and what their receipts say." />
      <SettingsTabs slug={org.slug} />
      <Card as="section" className="max-w-[860px] rounded-xl">
        <CardHeader title="Online payments" description="Members pay through your own Razorpay or Stripe account. Money goes straight to you." />
        <GatewaySettingsForm slug={org.slug} canEdit={canEdit} secretsReady={secretsReady} initial={{ ...gateway, verifiedAt: gateway.verifiedAt ? formatCalendarDate(localDate(gateway.verifiedAt, "UTC")) : null }} />
      </Card>
      <Card as="section" className="max-w-[860px] rounded-xl">
        <CardHeader title="Paying directly" description="UPI, bank transfer or cash. Members can tell you they've paid with a reference, and your team confirms it." />
        <OfflinePaymentsForm slug={org.slug} canEdit={canEdit} initial={offline} />
      </Card>
      <Card as="section" className="max-w-[860px] rounded-xl">
        <CardHeader title="Refunds" description="What members get back when they cancel. Every request comes to your team to approve or decline." />
        <RefundPolicyForm slug={org.slug} canEdit={canEdit} initial={refunds} />
      </Card>
      <Card as="section" className="max-w-[860px] rounded-xl">
        <CardHeader title="Tax and receipts" />
        <TaxSettingsForm slug={org.slug} canEdit={canEdit} initial={tax} />
      </Card>
    </div>
  );
}
