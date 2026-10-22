import type { Metadata } from "next";
import { loadOrgEmailSettingsView } from "@/lib/views/app__dashboard__orgSlug__settings__email__page";
import { formatCalendarDate, localDate } from "@/lib/calendarDate";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { OrgEmailForm } from "@/components/settings/OrgEmailForm";
import { Card, CardHeader } from "@/components/ui/display";

export const metadata: Metadata = { title: "Email", robots: { index: false, follow: false } };

export default async function OrgEmailSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { org, canEdit, platformSender, settings } = await loadOrgEmailSettingsView({ params });
  const { verifiedAt, ...initial } = settings;
  return (
    <div className="flex flex-col gap-6">
      <OrgPageHeader organisation={org} title="Settings" description="How emails to your customers are sent." />
      <SettingsTabs slug={org.slug} />
      <Card as="section" className="max-w-[860px] rounded-xl">
        <CardHeader
          title="Your own email"
          description={`Member emails (notices, receipts, renewal reminders, invites, cards and refund replies) can go out from your own address. Without it they come from ${platformSender} in ${org.name}'s name${org.contactEmail ? `, with replies to ${org.contactEmail}` : ""}. Sign-in emails such as password resets always come from the platform.`}
        />
        <OrgEmailForm slug={org.slug} canEdit={canEdit} initial={initial} verified={verifiedAt ? formatCalendarDate(localDate(verifiedAt, "UTC")) : null} />
      </Card>
    </div>
  );
}
