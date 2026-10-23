"use client";

import { useState } from "react";
import { setHoursException, removeHoursException } from "@/app/actions/space-calendar";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, TextField, text } from "@/components/bookings/FormFields";
import { IntervalsEditor, type Interval } from "./IntervalsEditor";
import { minuteText } from "@/lib/bookings/ui";

export type ExceptionRow = { id: string; date: string; closed: boolean; intervals: unknown; reason: string };
function intervalsOf(value: unknown): Interval[] {
  return Array.isArray(value) ? value.filter((item): item is Interval => item && typeof item.openMinute === "number" && typeof item.closeMinute === "number") : [];
}
export function ExceptionsPanel({ slug, spaceId, rows, inherited = [] }: { slug: string; spaceId: string | null; rows: ExceptionRow[]; inherited?: ExceptionRow[] }) {
  const [editing, setEditing] = useState<ExceptionRow | null>(null);
  const [closed, setClosed] = useState(true);
  const [intervals, setIntervals] = useState<Interval[]>([]);
  const scope = { makerspaceSlug: slug, spaceId };
  return <Card><CardHeader title="Hours exceptions" description={spaceId ? "A space's exceptions replace the makerspace set. Remove all to inherit." : "Close a local date or set special opening intervals."} />
    {(rows.length ? rows : inherited).map((row) => <div className="mb-4 flex flex-wrap items-center gap-3" key={row.id}>
      <p className="flex-1 text-ink">{row.date}: {row.closed ? "Closed" : intervalsOf(row.intervals).map((item) => `${minuteText(item.openMinute)}–${minuteText(item.closeMinute)}`).join(", ")} {row.reason}</p>
      {!rows.length ? <Chip>Inherited</Chip> : <>
        <Button variant="secondary" onClick={() => { setEditing(row); setClosed(row.closed); setIntervals(intervalsOf(row.intervals)); }}>Edit exception</Button>
        <ActionForm label="Remove exception" confirm="Bookings on this date will use the remaining opening hours." action={() => removeHoursException({ ...scope, exceptionId: row.id })} />
      </>}
    </div>)}
    {!rows.length && !inherited.length ? <p className="mb-4 text-ink-muted">No exceptions. Regular opening hours apply.</p> : null}
    <ActionForm key={editing?.id ?? "new"} guard label={editing ? "Save exception" : "Add exception"} action={(data) => setHoursException({ ...scope, exception: {
      date: editing?.date ?? text(data, "date"), closed, intervals: closed ? [] : intervals, reason: text(data, "reason"),
    } })} onSuccess={() => { setEditing(null); setClosed(true); setIntervals([]); }}>
      <TextField name="date" label="Local date" type="date" value={editing?.date} required disabled={Boolean(editing)} />
      <div onChange={(event) => setClosed((event.target as HTMLInputElement).checked)}><CheckField name="closed" label="Closed all day" checked={closed} /></div>
      {!closed ? <IntervalsEditor value={intervals} onChange={setIntervals} label="Special hours" /> : null}
      <TextField name="reason" label="Reason" value={editing?.reason} />
    </ActionForm>
    {editing ? <Button className="mt-3" variant="quiet" onClick={() => { setEditing(null); setClosed(true); setIntervals([]); }}>Cancel editing</Button> : null}
  </Card>;
}
