import type { Metadata } from "next";
import { loadOrgReportsMembers } from "@/lib/views/app__dashboard__orgSlug__reports__members__page";
import type { ReportSearch } from "@/lib/reports/context";
import { ReportShell } from "@/components/reports/ReportShell";
import { MemberBreakdowns, MemberRegister } from "@/components/reports/MemberSections";

export const metadata: Metadata = { title: "Member reports", robots: { index: false, follow: false } };

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch & { q?: string; standing?: string }> };

export default async function OrgReportsMembersPage({ params, searchParams }: Props) {
  const view = await loadOrgReportsMembers({ params, searchParams });
  return (
    <ReportShell shell={view.shell} title="Member reports">
      <MemberBreakdowns view={view} />
      <MemberRegister view={view} />
    </ReportShell>
  );
}
