import type { Metadata } from "next";
import { loadTechnicians } from "@/lib/views/app__dashboard__makerspaceSlug__technicians__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { TechnicianDirectory } from "@/components/repairs/TechnicianDirectory";

export const metadata: Metadata = { title: "Technicians", robots: { index: false, follow: false } };

export default async function TechniciansPage(props: Parameters<typeof loadTechnicians>[0]) {
  const view = await loadTechnicians(props);
  return <div className="flex flex-col gap-6">
    <MakerspacePageHeader makerspace={view.makerspace} title="Technicians" description="Who you can ask to fix things: your team's technicians and people outside it, with their skills." />
    <TechnicianDirectory makerspaceSlug={view.makerspace.slug} technicians={view.technicians} unlisted={view.unlisted} />
  </div>;
}
