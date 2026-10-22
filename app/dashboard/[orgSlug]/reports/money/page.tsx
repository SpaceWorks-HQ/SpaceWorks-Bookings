import type { Metadata } from "next";
import { loadOrgReportsMoney } from "@/lib/views/app__dashboard__orgSlug__reports__money__page";
import type { ReportSearch } from "@/lib/reports/context";
import { ExportLink, ReportShell } from "@/components/reports/ReportShell";
import { SubscriptionIncomeSection } from "@/components/reports/SubscriptionIncomeSection";
import { FinancePending, ForecastSection, MoneyKpis, OfflineSection, OutstandingSection, RevenueBreakdowns, RevenueCharts } from "@/components/reports/MoneySections";

export const metadata: Metadata = { title: "Money reports", robots: { index: false, follow: false } };

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<ReportSearch> };

export default async function OrgReportsMoneyPage({ params, searchParams }: Props) {
  const view = await loadOrgReportsMoney({ params, searchParams });
  return (
    <ReportShell shell={view.shell} title="Money" actions={view.shell.canExportFinance ? <ExportLink shell={view.shell} report="revenue" label="Export payments" /> : null}>
      <FinancePending view={view} />
      <MoneyKpis view={view} />
      <RevenueCharts view={view} />
      <RevenueBreakdowns view={view} />
      <ForecastSection view={view} />
      <OutstandingSection view={view} />
      <OfflineSection view={view} />
      <SubscriptionIncomeSection rows={view.subscriptionIncome.rows} yearLabel={view.subscriptionIncome.yearLabel} locale={view.locale} />
    </ReportShell>
  );
}
