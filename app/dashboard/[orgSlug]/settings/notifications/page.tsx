import type { Metadata } from "next";
import { loadOrgNotificationsView } from "@/lib/views/app__dashboard__orgSlug__settings__notifications__page";
import { formatCalendarDate, localDate } from "@/lib/membership/periods";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { ChatChannelsPanel } from "@/components/settings/ChatChannelsPanel";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

export default async function OrgNotificationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { org, canEdit, secretsReady, channels } = await loadOrgNotificationsView({ params });
  return (
    <div className="flex flex-col gap-6">
      <OrgPageHeader organisation={org} title="Settings" description="Where your team hears about things that need them." />
      <SettingsTabs slug={org.slug} />
      <ChatChannelsPanel
        slug={org.slug}
        canEdit={canEdit}
        secretsReady={secretsReady}
        channels={channels.map((channel) => ({ ...channel, lastDelivered: channel.lastDeliveredAt ? formatCalendarDate(localDate(channel.lastDeliveredAt, org.timezone)) : null }))}
      />
    </div>
  );
}
