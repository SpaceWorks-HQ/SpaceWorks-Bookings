"use client";

import { useState } from "react";
import { saveAddOn, removeAddOn } from "@/app/actions/spaces";
import { ActionForm } from "@/components/bookings/ActionForm";
import { TextField, SelectField, NotesField, amountInput, amountMinor, text, number } from "@/components/bookings/FormFields";
import { Card, CardHeader } from "@/components/ui/display";
import { Button } from "@/components/ui/button";

type AddOn = { id: string; name: string; description: string; unit: string; priceMinor: number; memberPriceMinor: number | null; sacCode: string | null; sortOrder: number };
export function AddOnsPanel({ slug, spaceId, rows, canMoney, currency }: { slug: string; spaceId: string; rows: AddOn[]; canMoney: boolean; currency: string }) {
  const [editing, setEditing] = useState<AddOn | null>(null);
  return <Card><CardHeader title="Add-ons" description={`Optional extras priced per booking, hour or person, in ${currency}.`} />
    {rows.map((row) => <div key={row.id} className="mb-4 flex flex-wrap items-center gap-3"><p className="flex-1 text-ink">{row.name}</p>
      <Button variant="secondary" onClick={() => setEditing(row)}>Edit add-on</Button>
      <ActionForm label="Remove add-on" confirm="Stop offering this add-on? Existing bookings keep their price snapshot." action={() => removeAddOn({ makerspaceSlug: slug, addOnId: row.id })} />
    </div>)}
    {!rows.length ? <p className="mb-4 text-ink-muted">No add-ons. Add equipment or services customers can choose.</p> : null}
    <ActionForm guard key={editing?.id ?? "new"} label={editing ? "Save add-on" : "Add extra"} onSuccess={() => setEditing(null)} action={(data) => saveAddOn({ makerspaceSlug: slug, spaceId, ...(editing ? { addOnId: editing.id } : {}), addOn: {
      name: text(data, "name"), description: text(data, "description"), unit: text(data, "unit"), priceMinor: amountMinor(text(data, "priceMinor"), currency),
      memberPriceMinor: text(data, "memberPriceMinor") === "" ? null : amountMinor(text(data, "memberPriceMinor"), currency),
      sacCode: canMoney ? text(data, "sacCode") || null : editing?.sacCode ?? null, active: true, sortOrder: number(data, "sortOrder"),
    } })}>
      <TextField name="name" label="Add-on name" value={editing?.name} required />
      <NotesField name="description" label="Description" value={editing?.description} maxLength={500} />
      <SelectField name="unit" label="Priced per" value={editing?.unit ?? "PER_BOOKING"} options={["PER_BOOKING", "PER_HOUR", "PER_PERSON"]} />
      <div className="grid gap-4 sm:grid-cols-2"><TextField name="priceMinor" label={`Public price (${currency})`} inputMode="decimal" value={amountInput(editing?.priceMinor ?? 0, currency)} required />
        <TextField name="memberPriceMinor" label={`Member price (${currency})`} inputMode="decimal" value={amountInput(editing?.memberPriceMinor, currency)} helper="Blank uses the public price." />
        <TextField name="sacCode" label="SAC" value={editing?.sacCode} disabled={!canMoney} helper={canMoney ? undefined : "Only the bookings manager can change tax."} />
        <TextField name="sortOrder" label="Sort order" value={editing?.sortOrder ?? 0} type="number" min={0} required />
      </div>
    </ActionForm>
    {editing ? <Button className="mt-3" variant="quiet" onClick={() => setEditing(null)}>Cancel editing</Button> : null}
  </Card>;
}
