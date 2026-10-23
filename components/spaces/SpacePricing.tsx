"use client";

import { updateSpace } from "@/app/actions/spaces";
import type { SpaceFields } from "@/lib/spaces/schemas";
import { ActionForm } from "@/components/bookings/ActionForm";
import { TextField, text, number } from "@/components/bookings/FormFields";
import { Card, CardHeader } from "@/components/ui/display";
import { AddOnsPanel } from "./AddOnsPanel";
import { PeakRulesPanel } from "./PeakRulesPanel";

const RATE_FIELDS = ["publicHourlyMinor", "publicHalfDayMinor", "publicDayMinor", "memberHourlyMinor", "memberHalfDayMinor", "memberDayMinor"] as const;
const RATE_LABELS = ["Public hourly", "Public half-day", "Public day", "Member hourly", "Member half-day", "Member day"];
type Props = { slug: string; currency: string; canMoney: boolean; space: SpaceFields & { id: string; addOns: Parameters<typeof AddOnsPanel>[0]["rows"]; peakRules: Parameters<typeof PeakRulesPanel>[0]["rows"] } };
export function SpacePricing({ slug, space, currency, canMoney }: Props) {
  return <div className="flex flex-col gap-6"><Card><CardHeader title="Rates" description={`Amounts are integer minor units in ${currency}. Blank public rates are not offered; blank member rates use public rates.`} />
    <ActionForm guard label="Save pricing" action={(data) => updateSpace({ makerspaceSlug: slug, spaceId: space.id, fields: {
      ...Object.fromEntries(RATE_FIELDS.map((key) => [key, text(data, key) === "" ? null : number(data, key)])),
      halfDayMinutes: number(data, "halfDayMinutes"), dayMinutes: number(data, "dayMinutes"),
      ...(canMoney ? { taxRateBps: text(data, "taxRateBps") === "" ? null : number(data, "taxRateBps"), sacCode: text(data, "sacCode") || null } : {}),
    } })}>
      <div className="grid gap-4 sm:grid-cols-2">{RATE_FIELDS.map((key, index) => <TextField key={key} name={key} label={`${RATE_LABELS[index]} (minor units)`} type="number" min={0} value={space[key]} />)}
        <TextField name="halfDayMinutes" label="Half-day length (minutes)" type="number" min={15} max={1440} required value={space.halfDayMinutes} />
        <TextField name="dayMinutes" label="Day length (minutes)" type="number" min={15} max={1440} required value={space.dayMinutes} />
        <TextField name="taxRateBps" label="Tax override (basis points)" type="number" min={0} max={10000} value={space.taxRateBps} disabled={!canMoney} helper="Blank inherits the makerspace tax rate." />
        <TextField name="sacCode" label="SAC override" value={space.sacCode} disabled={!canMoney} helper="Blank inherits the makerspace SAC." />
      </div>
    </ActionForm></Card>
    <AddOnsPanel slug={slug} spaceId={space.id} rows={space.addOns} canMoney={canMoney} />
    <PeakRulesPanel slug={slug} spaceId={space.id} rows={space.peakRules} />
  </div>;
}
