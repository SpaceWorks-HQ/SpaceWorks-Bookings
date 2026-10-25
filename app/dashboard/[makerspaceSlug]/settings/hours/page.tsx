import { loadHoursSettings } from "@/lib/views/app__dashboard__makerspaceSlug__settings__hours__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { HoursPanel } from "@/components/hours/HoursPanel";

export const metadata = { title: "Opening hours" };
export default async function Page(props: Parameters<typeof loadHoursSettings>[0]) {
  const { makerspace, calendar } = await loadHoursSettings(props);
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Settings" description={`When your makerspace is open, in ${makerspace.timezone}. Spaces can keep their own hours.`} />
    <SettingsTabs slug={makerspace.slug} /><HoursPanel slug={makerspace.slug} initial={calendar} timezone={makerspace.timezone} />
  </div>;
}
