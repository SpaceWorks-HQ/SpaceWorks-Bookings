"use client";

import { useState } from "react";
import { replaceRefundTiers } from "@/app/actions/spaces";
import { ActionForm } from "@/components/bookings/ActionForm";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { CheckField } from "@/components/bookings/FormFields";

type Tier = { minHoursBefore: number; refundBps: number };
export function RefundTiersForm({ slug, spaceId, tiers, inherited, canMoney }: { slug: string; spaceId: string; tiers: Tier[]; inherited: Tier[]; canMoney: boolean }) {
  const [rows, setRows] = useState(tiers.length ? tiers : inherited);
  const [inherit, setInherit] = useState(!tiers.length);
  const visibleRows = inherit ? inherited : rows;
  return <Card><CardHeader title="Refund policy" description="The first tier whose notice is met applies. Venue cancellations refund everything paid." />
    <Chip>{tiers.length ? "Space policy" : "Inherited from makerspace"}</Chip>
    <ActionForm guard disabled={!canMoney} label="Save refund policy" action={() => replaceRefundTiers({ makerspaceSlug: slug, spaceId, tiers: inherit ? [] : rows })}>
      {!canMoney ? <p className="text-ink-muted">Only the bookings manager can change the refund policy.</p> : null}
      <div onChange={(event) => setInherit((event.target as HTMLInputElement).checked)}><CheckField name="inherit" label="Inherit makerspace refund policy" checked={inherit} disabled={!canMoney} /></div>
      {visibleRows.map((tier, index) => <div className="flex flex-wrap items-end gap-3" key={index}>
        <Field label="Minimum notice (hours)"><Input type="number" min={0} max={8760} required value={tier.minHoursBefore} disabled={!canMoney || inherit} onChange={(event) => setRows(rows.map((row, i) => i === index ? { ...row, minHoursBefore: Number(event.target.value) } : row))} /></Field>
        <Field label="Refund (%)"><Input type="number" min={0} max={100} step="any" required value={tier.refundBps / 100} disabled={!canMoney || inherit} onChange={(event) => setRows(rows.map((row, i) => i === index ? { ...row, refundBps: Math.round(Number(event.target.value) * 100) } : row))} /></Field>
        {canMoney && !inherit ? <Button type="button" variant="quiet" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove tier</Button> : null}
      </div>)}
      {!visibleRows.length ? <p className="text-ink-muted">No tiers: customer cancellations receive a full refund, subject to any non-refundable deposit.</p> : null}
      {canMoney && !inherit ? <div><Button type="button" variant="secondary" onClick={() => setRows([...rows, { minHoursBefore: 0, refundBps: 0 }])}>Add tier</Button></div> : null}
    </ActionForm>
  </Card>;
}
