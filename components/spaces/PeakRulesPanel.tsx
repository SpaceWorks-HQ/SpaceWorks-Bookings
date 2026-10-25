"use client";

import { useState } from "react";
import { savePeakRule, removePeakRule } from "@/app/actions/spaces";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, TextField, bpsInput, percentBps, text } from "@/components/bookings/FormFields";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { WEEKDAYS, minuteText, parseMinute } from "@/lib/bookings/ui";

type Peak = { id: string; name: string; weekdays: number[]; startMinute: number; endMinute: number; surchargeBps: number; active: boolean };
export function PeakRulesPanel({ slug, spaceId, rows }: { slug: string; spaceId: string; rows: Peak[] }) {
  const [editing, setEditing] = useState<Peak | null>(null);
  return <Card><CardHeader title="Peak rules" description="Apply a surcharge to the portion of a booking within these local-time intervals." />
    {rows.map((row) => <div className="mb-4 flex flex-wrap items-center gap-3" key={row.id}><p className="flex-1 text-ink">{row.name} · {row.weekdays.map((day) => WEEKDAYS[day]).join(", ")} · {minuteText(row.startMinute)}–{minuteText(row.endMinute)} · {row.surchargeBps / 100}%</p>
      <Chip>{row.active ? "Active" : "Inactive"}</Chip><Button variant="secondary" onClick={() => setEditing(row)}>Edit peak rule</Button>
      <ActionForm label="Remove peak rule" confirm="Remove this surcharge from future quotes?" action={() => removePeakRule({ makerspaceSlug: slug, ruleId: row.id })} />
    </div>)}
    {!rows.length ? <p className="mb-4 text-ink-muted">No peak rules. Rates stay the same throughout opening hours.</p> : null}
    <ActionForm guard key={editing?.id ?? "new"} label={editing ? "Save peak rule" : "Add peak rule"} onSuccess={() => setEditing(null)} action={(data) => savePeakRule({ makerspaceSlug: slug, spaceId, ...(editing ? { ruleId: editing.id } : {}), rule: {
      name: text(data, "name"), weekdays: WEEKDAYS.flatMap((_, index) => data.has(`day-${index}`) ? [index] : []), startMinute: parseMinute(text(data, "start")), endMinute: parseMinute(text(data, "end"), true),
      surchargeBps: percentBps(data, "surchargeBps"), active: data.has("active"),
    } })}>
      <TextField name="name" label="Rule name" value={editing?.name} required />
      <div className="grid gap-2 sm:grid-cols-3">{WEEKDAYS.map((day, index) => <CheckField key={day} name={`day-${index}`} label={day} checked={editing?.weekdays.includes(index)} />)}</div>
      <div className="grid gap-4 sm:grid-cols-2"><TextField name="start" label="Start (HH:MM)" value={minuteText(editing?.startMinute ?? 540)} required />
        <TextField name="end" label="End (HH:MM, up to 24:00)" value={minuteText(editing?.endMinute ?? 1020)} required />
        <TextField name="surchargeBps" label="Surcharge (%)" type="number" min={0.01} step="any" value={bpsInput(editing?.surchargeBps ?? 1000)} required />
      </div><CheckField name="active" label="Active" checked={editing?.active ?? true} />
    </ActionForm>
    {editing ? <Button className="mt-3" variant="quiet" onClick={() => setEditing(null)}>Cancel editing</Button> : null}
  </Card>;
}
