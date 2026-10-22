import type { Metadata } from "next";
import { loadMakerspaceNotificationsView } from "@/lib/views/app__dashboard__makerspaceSlug__settings__notifications__page";
import { formatCalendarDate, localDate } from "@/lib/calendarDate";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { ChatChannelsPanel } from "@/components/settings/ChatChannelsPanel";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

export default async function MakerspaceNotificationsPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspace, canEdit, secretsReady, channels } = await loadMakerspaceNotificationsView({ params });
  return (
    <div className="flex flex-col gap-6">
      <MakerspacePageHeader makerspace={makerspace} title="Settings" description="Where your team hears about things that need them." />
      <SettingsTabs slug={makerspace.slug} />
      <ChatChannelsPanel
        slug={makerspace.slug}
        canEdit={canEdit}
        secretsReady={secretsReady}
        channels={channels.map((channel) => ({ ...channel, lastDelivered: channel.lastDeliveredAt ? formatCalendarDate(localDate(channel.lastDeliveredAt, makerspace.timezone)) : null }))}
      />
    </div>
  );
}
