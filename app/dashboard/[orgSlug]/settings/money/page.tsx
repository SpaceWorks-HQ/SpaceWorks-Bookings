import type { Metadata } from "next";
import { loadOrgMoneySettingsView } from "@/lib/views/app__dashboard__orgSlug__settings__money__page";
import { OrgPageHeader } from "@/components/dashboard/org/OrgPageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { MoneySettingsForm } from "@/components/settings/MoneySettingsForm";
import { Card } from "@/components/ui/display";

export const metadata: Metadata = { title: "Money and year", robots: { index: false, follow: false } };

export default async function OrgMoneySettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { org, canEdit, calendarLocked, timezones } = await loadOrgMoneySettingsView({ params });
  return (
    <div className="flex flex-col gap-6">
      <OrgPageHeader organisation={org} title="Settings" description="Currency, the financial year and how offline payments are confirmed." />
      <SettingsTabs slug={org.slug} />
      <Card as="section" className="max-w-[860px] rounded-xl">
        <MoneySettingsForm
          slug={org.slug}
          disabled={!canEdit}
          calendarLocked={calendarLocked}
          timezones={timezones}
          initial={{
            currency: org.currency,
            locale: org.locale ?? "",
            timezone: org.timezone,
            financialYearStartMonth: org.financialYearStartMonth,
            offlineConfirmationRequired: org.offlineConfirmationRequired,
          }}
        />
      </Card>
    </div>
  );
}
