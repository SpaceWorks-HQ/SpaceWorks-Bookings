import type { Metadata } from "next";
import { loadOrgReportsTax } from "@/lib/views/app__dashboard__orgSlug__reports__tax__page";
import type { ReportSearch } from "@/lib/reports/context";
import { ReportShell } from "@/components/reports/ReportShell";
import { DocumentRegister, GstSection, SeriesChecks, SimpleTaxSection } from "@/components/reports/TaxSections";
import { Callout } from "@/components/ui/display";

export const metadata: Metadata = { title: "Tax and receipts", robots: { index: false, follow: false } };

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch & { month?: string }> };

export default async function OrgReportsTaxPage({ params, searchParams }: Props) {
  const view = await loadOrgReportsTax({ params, searchParams });
  return (
    <ReportShell shell={view.shell} title="Tax and receipts">
      {view.shell.tabs.financeReady ? null : (
        <Callout tone="info" title="Receipts are not issued on this instance yet">
          The numbering check, documents register and GST return figures fill in once payments and receipts are switched on.
        </Callout>
      )}
      <SeriesChecks view={view} />
      <DocumentRegister view={view} />
      <GstSection view={view} />
      <SimpleTaxSection view={view} />
    </ReportShell>
  );
}
