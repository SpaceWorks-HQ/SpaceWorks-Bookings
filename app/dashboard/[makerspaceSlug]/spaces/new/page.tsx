import { loadNewSpace } from "@/lib/views/app__dashboard__makerspaceSlug__spaces__new__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SpaceDetailsForm } from "@/components/spaces/SpaceDetailsForm";

export const metadata = { title: "Add space" };
export default async function Page(props: Parameters<typeof loadNewSpace>[0]) {
  const { makerspace } = await loadNewSpace(props);
  return <div className="flex flex-col gap-6"><MakerspacePageHeader makerspace={makerspace} title="Add space" /><SpaceDetailsForm slug={makerspace.slug} /></div>;
}
