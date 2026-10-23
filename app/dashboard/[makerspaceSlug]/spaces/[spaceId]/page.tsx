import { loadSpace } from "@/lib/views/app__dashboard__makerspaceSlug__spaces__spaceId__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { NavTabs } from "@/components/ui/tabs";
import { SpaceDetailsForm } from "@/components/spaces/SpaceDetailsForm";
import { SpacePhotos } from "@/components/spaces/SpacePhotos";
import { SpacePricing } from "@/components/spaces/SpacePricing";
import { HoursPanel } from "@/components/hours/HoursPanel";
import { BookingRulesForm } from "@/components/settings/BookingRulesForm";
import { RefundTiersForm } from "@/components/spaces/RefundTiersForm";
import { words } from "@/lib/bookings/ui";

export const metadata = { title: "Space settings" };
export default async function Page(props: Parameters<typeof loadSpace>[0]) {
  const data = await loadSpace(props);
  const { makerspace, space, canMoney } = data;
  const slug = makerspace.slug;
  const tabs = ["details", "photos", "pricing", "availability", "rules", "refunds"];
  const tab = tabs.includes(data.tab) ? data.tab : "details";
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title={space.name} description="Manage the space, its availability and booking terms." />
    <NavTabs label="Space settings" items={tabs.map((key) => ({ label: words(key), href: `?tab=${key}`, active: key === tab }))} />
    {tab === "details" ? <SpaceDetailsForm key={space.id} slug={slug} initial={space} /> : null}
    {tab === "photos" ? <SpacePhotos slug={slug} spaceId={space.id} photos={space.photos} /> : null}
    {tab === "pricing" ? <SpacePricing slug={slug} space={space} currency={makerspace.currency} canMoney={canMoney} /> : null}
    {tab === "availability" ? <HoursPanel slug={slug} spaceId={space.id} initial={data.calendar} inherited={data.inherited} timezone={makerspace.timezone} /> : null}
    {tab === "rules" ? <BookingRulesForm slug={slug} spaceId={space.id} rules={data.rules} defaults={data.defaults} canMoney={canMoney} /> : null}
    {tab === "refunds" ? <RefundTiersForm slug={slug} spaceId={space.id} tiers={space.refundTiers} inherited={data.defaultTiers} canMoney={canMoney} /> : null}
  </div>;
}
