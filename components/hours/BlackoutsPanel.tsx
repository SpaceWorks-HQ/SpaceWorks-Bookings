"use client";

import { useState } from "react";
import { createBlackout, removeBlackout } from "@/app/actions/space-calendar";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { Field, Dropdown } from "@/components/ui/field";
import { ActionForm } from "@/components/bookings/ActionForm";
import { TextField, text } from "@/components/bookings/FormFields";
import { formatDayTime } from "@/lib/format/datetime";
import { localInputToIso } from "@/lib/bookings/ui";

export type BlackoutRow = { id: string; startDate: string | null; endDate: string | null; startsAt: string | null; endsAt: string | null; reason: string };
export function BlackoutsPanel({ slug, spaceId, rows, inherited = [], timezone }: {
  slug: string; spaceId: string | null; rows: BlackoutRow[]; inherited?: BlackoutRow[]; timezone: string;
}) {
  const [timed, setTimed] = useState(false);
  const scope = { makerspaceSlug: slug, spaceId };
  return <Card><CardHeader title="Blackouts" description="Block new bookings. Existing bookings stay in place." />
    {[...rows, ...inherited].map((row) => <div key={row.id} className="mb-4 flex flex-wrap items-center gap-3">
      <p className="flex-1 text-ink">{row.startDate ? `${row.startDate}–${row.endDate} (inclusive)` : `${formatDayTime(row.startsAt!, timezone)}–${formatDayTime(row.endsAt!, timezone)}`} {row.reason}</p>
      {inherited.includes(row) ? <Chip>Makerspace blackout</Chip> : <ActionForm label="Remove blackout" confirm="This time will become available for new bookings." action={() => removeBlackout({ ...scope, blackoutId: row.id })} />}
    </div>)}
    {!rows.length && !inherited.length ? <p className="mb-4 text-ink-muted">No blackouts. Add a closure for maintenance or a private event.</p> : null}
    <ActionForm guard label="Add blackout" action={(data) => createBlackout({ ...scope, blackout: timed
      ? { startsAt: localInputToIso(text(data, "start"), timezone), endsAt: localInputToIso(text(data, "end"), timezone, true), reason: text(data, "reason") }
      : { startDate: text(data, "start"), endDate: text(data, "end"), reason: text(data, "reason") } })}>
      <Field label="Closure type"><Dropdown value={timed ? "timed" : "days"} onChange={(event) => setTimed(event.target.value === "timed")}><option value="days">Whole local days</option><option value="timed">Exact times</option></Dropdown></Field>
      <div key={String(timed)} className="grid gap-4 sm:grid-cols-2"><TextField name="start" label="Starts" type={timed ? "datetime-local" : "date"} required /><TextField name="end" label="Ends" type={timed ? "datetime-local" : "date"} required /></div>
      <TextField name="reason" label="Reason" />
    </ActionForm>
  </Card>;
}
