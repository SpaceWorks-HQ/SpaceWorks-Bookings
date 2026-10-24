import type { Metadata } from "next";
import { loadMakerspaceMoneySettingsView } from "@/lib/views/app__dashboard__makerspaceSlug__settings__money__page";
import { MakerspacePageHeader } from "@/components/dashboard/makerspace/MakerspacePageHeader";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { MoneySettingsForm } from "@/components/settings/MoneySettingsForm";
import { Card } from "@/components/ui/display";

export const metadata: Metadata = { title: "Money and year", robots: { index: false, follow: false } };

export default async function MakerspaceMoneySettingsPage({ params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspace, canEdit, calendarLocked, timezones } = await loadMakerspaceMoneySettingsView({ params });
  return (
    <div className="flex flex-col gap-6">
      <MakerspacePageHeader makerspace={makerspace} title="Settings" description="Currency, the financial year and how offline payments are confirmed." />
      <SettingsTabs slug={makerspace.slug} />
      <Card as="section" className="max-w-[860px] rounded-xl">
        <MoneySettingsForm
          slug={makerspace.slug}
          disabled={!canEdit}
          calendarLocked={calendarLocked}
          timezones={timezones}
          initial={{
            currency: makerspace.currency,
            locale: makerspace.locale ?? "",
            timezone: makerspace.timezone,
            financialYearStartMonth: makerspace.financialYearStartMonth,
            offlineConfirmationRequired: makerspace.offlineConfirmationRequired,
          }}
        />
      </Card>
    </div>
  );
}
