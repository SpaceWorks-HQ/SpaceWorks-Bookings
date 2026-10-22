import Link from "next/link";
import type { Metadata } from "next";
import { loadOrgReportsOverview } from "@/lib/views/app__dashboard__orgSlug__reports__page";
import type { ReportSearch } from "@/lib/reports/context";
import { MembershipBridge, OverviewKpis, OverviewNow, OverviewTrends } from "@/components/reports/OverviewSections";
import { PrintButton } from "@/components/reports/PrintButton";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Report snapshot", robots: { index: false, follow: false } };

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch & { print?: string }> };

/**
 * B1 PDF snapshot: the overview laid out for A4 and printed by the browser ("Save as PDF"), so the PDF
 * matches the screen exactly and needs no server-side renderer. The print view hides the app chrome.
 */
export default async function OrgReportsPrintPage({ params, searchParams }: Props) {
  const search = await searchParams;
  const view = await loadOrgReportsOverview({ params, searchParams: Promise.resolve(search) });
  const generated = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: view.timezone }).format(view.generatedAt);
  return (
    <div className="sw-print-root flex flex-col gap-5 bg-canvas">
      <div className="sw-print-hide flex flex-wrap items-center justify-between gap-3">
        <Link href={`/dashboard/${view.shell.org.slug}/reports${view.shell.query}`} className={buttonClasses({ variant: "secondary" })}>Back to reports</Link>
        <PrintButton auto={search.print === "1"} />
      </div>
      <header className="flex flex-col gap-1 border-b border-line pb-4">
        <p className="text-label text-ink-muted">Membership report</p>
        <h1 className="text-h1 text-ink">{view.shell.org.name}</h1>
        <p className="text-body-ui text-ink-secondary">
          {view.shell.period.label} ({view.shell.period.firstDay} to {view.shell.period.lastDay})
          {view.shell.scopedUnitName ? ` · ${view.shell.scopedUnitName}` : ""} · Generated {generated}
        </p>
      </header>
      <div className="sw-print-page flex flex-col gap-5">
        <MembershipBridge view={view} />
        <OverviewKpis view={view} />
      </div>
      <div className="sw-print-page flex flex-col gap-5">
        <OverviewTrends view={view} />
        <OverviewNow view={view} />
      </div>
      <p className="text-caption text-ink-muted">Definitions: Active excludes grace. Renewal rate is renewed ÷ (renewed + lapsed) for memberships that ended in the period. Churn is members who lapsed and are not back, ÷ active at the start.</p>
    </div>
  );
}
