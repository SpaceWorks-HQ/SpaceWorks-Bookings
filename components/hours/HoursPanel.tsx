"use client";

import { useState } from "react";
import { replaceOpeningHours } from "@/app/actions/space-calendar";
import { WEEKDAYS } from "@/lib/bookings/ui";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckboxField } from "@/components/ui/choice";
import { IntervalsEditor } from "./IntervalsEditor";
import { ExceptionsPanel, type ExceptionRow } from "./ExceptionsPanel";
import { BlackoutsPanel, type BlackoutRow } from "./BlackoutsPanel";
import { hoursChoiceError } from "@/lib/spaces/hoursChoice";

type Hours = Array<{ weekday: number; openMinute: number; closeMinute: number }>;
export type CalendarValues = { hours: Hours; exceptions: ExceptionRow[]; blackouts: BlackoutRow[] };
export function HoursPanel({ slug, spaceId = null, initial, inherited, timezone }: {
  slug: string; spaceId?: string | null; initial: CalendarValues; inherited?: CalendarValues; timezone: string;
}) {
  const [hours, setHours] = useState(initial.hours);
  const [inherit, setInherit] = useState(Boolean(spaceId && !initial.hours.length));
  const [openAllDay, setOpenAllDay] = useState(false);
  return <div className="flex flex-col gap-6">
    <Card><CardHeader title="Opening hours" description={`Local times in ${timezone}. A day without intervals is closed.`} />
      {spaceId ? <Chip>{initial.hours.length ? "Space hours" : "Inherited from makerspace"}</Chip> : null}
      <ActionForm guard label="Save opening hours" action={() => {
        const next = inherit || openAllDay ? [] : hours;
        const error = hoursChoiceError(spaceId, next, openAllDay);
        return error ? Promise.resolve({ ok: false as const, error }) : replaceOpeningHours({ makerspaceSlug: slug, spaceId, hours: next, openAllDay });
      }}>
        {spaceId ? <CheckboxField name="inherit" label="Use the makerspace hours (no space hours set)" checked={inherit} onCheckedChange={(value) => setInherit(value === true)} />
          : <CheckboxField name="openAllDay" label="Open all day, every day" checked={openAllDay} onCheckedChange={(value) => setOpenAllDay(value === true)} />}
        {!spaceId && !hours.length && !openAllDay ? <p role="alert">{hoursChoiceError(null, [])}</p> : null}
        {spaceId && !hours.length && !inherit ? <p>No space hours set. Saving uses the makerspace hours.</p> : null}
        <div hidden={openAllDay}>
        {inherit ? <p className="text-ink-secondary">{inherited?.hours.map((row, index) => <span className="block" key={index}>{WEEKDAYS[row.weekday]}: {String(Math.floor(row.openMinute / 60)).padStart(2, "0")}:{String(row.openMinute % 60).padStart(2, "0")}–{String(Math.floor(row.closeMinute / 60)).padStart(2, "0")}:{String(row.closeMinute % 60).padStart(2, "0")}</span>)}{!inherited?.hours.length ? "No makerspace hours set: open all day, every day." : null}</p> : WEEKDAYS.map((day, weekday) => <section key={day} className="border-b border-line pb-4">
          <h3 className="mb-2 font-semibold text-ink">{day}</h3>
          <IntervalsEditor label={day} value={hours.filter((row) => row.weekday === weekday)} onChange={(intervals) => setHours([...hours.filter((row) => row.weekday !== weekday), ...intervals.map((row) => ({ ...row, weekday }))])} />
        </section>)}
        </div>
      </ActionForm>
    </Card>
    <ExceptionsPanel slug={slug} spaceId={spaceId} rows={initial.exceptions} inherited={inherited?.exceptions} />
    <BlackoutsPanel slug={slug} spaceId={spaceId} rows={initial.blackouts} inherited={inherited?.blackouts} timezone={timezone} />
  </div>;
}
