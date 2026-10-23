import type { Metadata } from "next";
import { Callout, PageHeader } from "@/components/ui/display";
import { JobsPanel } from "@/components/super-admin/JobsPanel";
import { loadSuperAdminJobsView } from "@/lib/views/app__super-admin__jobs__page";
import { requireSuperAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Jobs" };

export default async function SuperAdminJobsPage() {
  await requireSuperAdmin();
  const { health } = await loadSuperAdminJobsView();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" description="Background work for this instance. Pausing stops new claims; active jobs finish. Completed jobs are kept for a day and failures for up to 30 days." />
      {health ? <JobsPanel health={health} /> : <Callout tone="warning" role="alert" title="Jobs are unavailable">Check Redis and the worker and beat services, then refresh this page.</Callout>}
    </div>
  );
}
