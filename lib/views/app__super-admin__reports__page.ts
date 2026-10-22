import { requireSuperAdmin } from "@/lib/permissions";
import { paymentVolume } from "@/lib/reports/finance/forecast";
import { FINANCE_TABLES_READY, loadPlatformPayments } from "@/lib/reports/finance/source";
import { platformAudit, rollupAcrossTenants, systemHealth, tenantPipeline, usageVsLimits } from "@/lib/reports/platform";

const DAY = 86_400_000;
const WINDOWS = { "30d": 30, "90d": 90, "12m": 365 } as const;

type Props = { searchParams: Promise<{ window?: string }> };

/**
 * Platform reports: A1 tenant pipeline, A2 tenant base and A3 members across tenants (from the daily
 * rollup), A4 payment volume per currency, A5 usage against limits, A6 outbox health, A7 basic system
 * health and A8 the platform audit. Counts only: no member's personal data appears here.
 */
export async function loadSuperAdminReportsView({ searchParams }: Props) {
  await requireSuperAdmin();
  const { window: requested } = await searchParams;
  const key = (Object.hasOwn(WINDOWS, requested ?? "") ? requested : "90d") as keyof typeof WINDOWS;
  const now = new Date();
  const window = { from: new Date(now.getTime() - WINDOWS[key] * DAY), to: now };
  const [pipeline, tenants, usage, health, audit, payments] = await Promise.all([
    tenantPipeline(window),
    rollupAcrossTenants(now),
    usageVsLimits(),
    systemHealth(now),
    platformAudit(20),
    loadPlatformPayments(window),
  ]);
  return { window: key, now, pipeline, tenants, usage, health, audit, volume: paymentVolume(payments, window), financeReady: FINANCE_TABLES_READY };
}

export type SuperAdminReportsView = Awaited<ReturnType<typeof loadSuperAdminReportsView>>;
