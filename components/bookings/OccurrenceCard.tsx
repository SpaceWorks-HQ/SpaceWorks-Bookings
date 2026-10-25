"use client";

import { ChevronRight } from "lucide-react";
import { rescheduleOccurrence } from "@/app/actions/bookings-staff";
import { Card, Chip } from "@/components/ui/display";
import { formatDate, formatTimeRange } from "@/lib/format/datetime";
import { instantToLocalInput, localInputToIso, words } from "@/lib/bookings/ui";
import { money } from "@/lib/money/currencies";
import { ActionForm } from "./ActionForm";
import { TextField, text } from "./FormFields";
import { OverrideField, overrideInput } from "./OverrideField";
import { AttendanceActions } from "./AttendanceActions";

export type OccurrenceView = { id: string; startsAt: string; endsAt: string; slotIndex: number; unit: number; status: string; priceMinor: number; noShowAt: string | null };
export function OccurrenceCard({ slug, bookingId, bookingStatus, row, timezone, currency, canManage, canOverride, firstUnit }: {
  slug: string; bookingId: string; bookingStatus: string; row: OccurrenceView; timezone: string; currency: string; canManage: boolean; canOverride: boolean; firstUnit: boolean;
}) {
  const scheduled = row.status === "SCHEDULED";
  return <Card><div className="mb-3 flex flex-wrap items-center gap-3"><h3 className="flex-1 font-semibold text-ink">{formatDate(row.startsAt, timezone)} · Unit {row.unit + 1}</h3>
    <Chip>{row.noShowAt ? "No-show" : words(row.status)}</Chip><span className="text-ink">{money(row.priceMinor, currency)}</span></div>
    <p className="mb-4 text-ink-secondary">{formatTimeRange(row.startsAt, row.endsAt, timezone)}</p>
    {firstUnit && scheduled && bookingStatus === "CONFIRMED" && canManage ? <AttendanceActions slug={slug} occurrenceId={row.id} noShow={Boolean(row.noShowAt)} /> : null}
    {firstUnit && scheduled && canManage && ["REQUESTED", "CONFIRMED"].includes(bookingStatus) ? <details className="group mt-4"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-accent-text [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-90" />Reschedule this occurrence (all its units)</summary>
      <div className="mt-4"><ActionForm guard label="Reschedule occurrence" action={(data) => rescheduleOccurrence({ makerspaceSlug: slug, bookingId, occurrenceId: row.id,
        start: localInputToIso(text(data, "start"), timezone), end: localInputToIso(text(data, "end"), timezone, true), ...(canOverride ? overrideInput(data) : {}),
      })}>
        <div className="grid gap-4 sm:grid-cols-2"><TextField name="start" label={`New start (${timezone})`} type="datetime-local" value={instantToLocalInput(row.startsAt, timezone)} required />
          <TextField name="end" label={`New end (${timezone})`} type="datetime-local" value={instantToLocalInput(row.endsAt, timezone)} required /></div>
        {canOverride ? <OverrideField /> : null}
      </ActionForm></div>
    </details> : null}
  </Card>;
}
