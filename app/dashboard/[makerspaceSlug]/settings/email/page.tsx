import type { Metadata } from "next";
import { loadMakerspaceEmailSettingsView } from "@/lib/views/app__dashboard__makerspaceSlug__settings__email__page";
import { formatCalendarDate, localDate } from "@/lib/calendarDate";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { MakerspaceEmailForm } from "@/components/settings/MakerspaceEmailForm";
import { Card, CardHeader } from "@/components/ui/display";

export const metadata: Metadata = { title: "Email", robots: { index: false, follow: false } };

export default async function MakerspaceEmailSettingsPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspace, canEdit, platformSender, settings } = await loadMakerspaceEmailSettingsView({ params });
  const { verifiedAt, ...initial } = settings;
  return (
    <div className="flex flex-col gap-6">
      <MakerspacePageHeader makerspace={makerspace} title="Settings" description="How emails to your customers are sent." />
      <SettingsTabs slug={makerspace.slug} />
      <Card as="section" className="max-w-[860px] rounded-xl">
        <CardHeader
          title="Your own email"
          description={`Customer emails (booking notices, receipts and refunds) can go out from your own address. Without it they come from ${platformSender} in ${makerspace.name}'s name${makerspace.contactEmail ? `, with replies to ${makerspace.contactEmail}` : ""}. Sign-in emails such as password resets always come from the platform.`}
        />
        <MakerspaceEmailForm slug={makerspace.slug} canEdit={canEdit} initial={initial} verified={verifiedAt ? formatCalendarDate(localDate(verifiedAt, "UTC")) : null} />
      </Card>
    </div>
  );
}
