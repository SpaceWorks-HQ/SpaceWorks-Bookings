import { loadMakerspaceSlugShell } from "@/lib/views/app__dashboard__makerspaceSlug__layout";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export default async function MakerspaceSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ makerspaceSlug: string; }>;
}) {
  const { makerspace } = await loadMakerspaceSlugShell({ params });
  return (
    <DashboardLayout
      makerspaceName={makerspace.name}
      makerspaceSlug={makerspace.slug}
    >
      {children}
    </DashboardLayout>
  );
}
