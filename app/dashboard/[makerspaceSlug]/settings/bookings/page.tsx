import { loadBookingSettings } from "@/lib/views/app__dashboard__makerspaceSlug__settings__bookings__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { BookingRulesForm } from "@/components/settings/BookingRulesForm";

export const metadata = { title: "Booking settings" };
export default async function Page(props: Parameters<typeof loadBookingSettings>[0]) {
  const data = await loadBookingSettings(props);
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={data.makerspace} title="Booking settings" description="Defaults for every space. Individual spaces can override these rules." />
    <SettingsTabs slug={data.makerspace.slug} /><BookingRulesForm slug={data.makerspace.slug} {...data} />
  </div>;
}
