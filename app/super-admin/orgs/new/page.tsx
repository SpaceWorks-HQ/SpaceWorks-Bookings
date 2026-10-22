import Link from "next/link";
import { requireSuperAdmin } from "@/lib/permissions";
import { ArrowLeft } from "lucide-react";
import { loadSuperAdminNewOrgView } from "@/lib/views/app__super-admin__orgs__new__page";
import { CreateOrganisationForm } from "@/components/super-admin/CreateOrganisationForm";
import { PageHeader } from "@/components/ui/display";

export default async function SuperAdminNewOrgPage() {
  await requireSuperAdmin();
  await loadSuperAdminNewOrgView();
  return (
    <div className="flex max-w-[760px] flex-col gap-6">
      <Link href="/super-admin/orgs" className="inline-flex w-fit items-center gap-1 text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        Organisations
      </Link>
      <PageHeader title="Add an organisation" description="Skip the application: set it up as active and invite its owner." />
      <CreateOrganisationForm />
    </div>
  );
}
