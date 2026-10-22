import { loadOrgSlugShell } from "@/lib/views/app__dashboard__orgSlug__layout";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";

export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string; }>;
}) {
  const { organisation } = await loadOrgSlugShell({ params });
  return (
    <DashboardLayout
      organisationName={organisation.name}
      organisationSlug={organisation.slug}
    >
      {children}
    </DashboardLayout>
  );
}
