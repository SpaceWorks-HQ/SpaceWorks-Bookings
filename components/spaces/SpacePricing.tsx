"use client";

import { updateSpace } from "@/app/actions/spaces";
import type { SpaceFields } from "@/lib/spaces/schemas";
import { ActionForm } from "@/components/bookings/ActionForm";
import { TextField, amountInput, amountMinor, bpsInput, percentBps, text, number } from "@/components/bookings/FormFields";
import { Card, CardHeader } from "@/components/ui/display";
import { AddOnsPanel } from "./AddOnsPanel";
import { PeakRulesPanel } from "./PeakRulesPanel";

const RATE_FIELDS = ["publicHourlyMinor", "publicHalfDayMinor", "publicDayMinor", "memberHourlyMinor", "memberHalfDayMinor", "memberDayMinor"] as const;
const RATE_LABELS = ["Public hourly", "Public half-day", "Public day", "Member hourly", "Member half-day", "Member day"];
type Props = { slug: string; currency: string; canMoney: boolean; space: SpaceFields & { id: string; addOns: Parameters<typeof AddOnsPanel>[0]["rows"]; peakRules: Parameters<typeof PeakRulesPanel>[0]["rows"] } };
export function SpacePricing({ slug, space, currency, canMoney }: Props) {
  return <div className="flex flex-col gap-6"><Card><CardHeader title="Rates" description={`Amounts in ${currency}, for example 800 or 800.50. Leave a public rate blank to not offer it; a blank member rate uses the public one.`} />
    <ActionForm guard label="Save pricing" action={(data) => updateSpace({ makerspaceSlug: slug, spaceId: space.id, fields: {
      ...Object.fromEntries(RATE_FIELDS.map((key) => [key, text(data, key) === "" ? null : amountMinor(text(data, key), currency)])),
      halfDayMinutes: number(data, "halfDayMinutes"), dayMinutes: number(data, "dayMinutes"),
      ...(canMoney ? { taxRateBps: text(data, "taxRateBps") === "" ? null : percentBps(data, "taxRateBps"), sacCode: text(data, "sacCode") || null } : {}),
    } })}>
      <div className="grid gap-4 sm:grid-cols-2">{RATE_FIELDS.map((key, index) => <TextField key={key} name={key} label={`${RATE_LABELS[index]} (${currency})`} inputMode="decimal" value={amountInput(space[key], currency)} />)}
        <TextField name="halfDayMinutes" label="Half-day length (minutes)" type="number" min={15} max={1440} required value={space.halfDayMinutes} />
        <TextField name="dayMinutes" label="Day length (minutes)" type="number" min={15} max={1440} required value={space.dayMinutes} />
        <TextField name="taxRateBps" label="Tax override (%)" type="number" min={0} max={100} step="any" value={bpsInput(space.taxRateBps)} disabled={!canMoney} helper={canMoney ? "Blank uses the makerspace tax rate." : "Only the bookings manager can change tax."} />
        <TextField name="sacCode" label="SAC override" value={space.sacCode} disabled={!canMoney} helper={canMoney ? "Blank uses the makerspace SAC." : "Only the bookings manager can change tax."} />
      </div>
    </ActionForm></Card>
    <AddOnsPanel slug={slug} spaceId={space.id} rows={space.addOns} canMoney={canMoney} currency={currency} />
    <PeakRulesPanel slug={slug} spaceId={space.id} rows={space.peakRules} />
  </div>;
}
