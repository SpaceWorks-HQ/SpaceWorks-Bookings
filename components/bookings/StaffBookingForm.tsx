"use client";

import { useState } from "react";
import { createHold, submitBooking, cancelBooking } from "@/app/actions/bookings-staff";
import { useRouter } from "next/navigation";
import { ActionForm } from "./ActionForm";
import { CheckField, SelectField, TextField, NotesField, number, text } from "./FormFields";
import { OverrideField, overrideInput } from "./OverrideField";
import { Card, CardHeader, Callout, EmptyState } from "@/components/ui/display";
import { Field, Dropdown } from "@/components/ui/field";
import { localInputToIso, words } from "@/lib/bookings/ui";
import { formatDayTime } from "@/lib/format/datetime";
import { money } from "@/lib/money/currencies";

type Hold = { bookingId: string; reference: string; holdExpiresAt: Date | string; skipped: number };
type Props = { slug: string; timezone: string; currency: string; spaces: Array<{ id: string; name: string; capacity: number; units: number }>;
  addOns: Array<{ id: string; name: string; spaceId: string | null; priceMinor: number; unit: string }>; canOverride: boolean };
export function StaffBookingForm({ slug, timezone, currency, spaces, addOns, canOverride }: Props) {
  const router = useRouter();
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [recurring, setRecurring] = useState(false);
  const [hold, setHold] = useState<Hold | null>(null);
  if (!spaces.length) return <EmptyState title="Add a space first">A space needs rates and opening hours before customers can book it.</EmptyState>;
  const space = spaces.find((row) => row.id === spaceId)!;
  return <div className="flex flex-col gap-6">
    {!hold ? <Card><CardHeader title="Choose a time" description={`Times use ${timezone}. Hold the slot before entering the customer's details.`} />
      <ActionForm guard label="Hold booking times" action={(data) => createHold({ makerspaceSlug: slug, spaceId,
        start: localInputToIso(text(data, "start"), timezone), end: localInputToIso(text(data, "end"), timezone, true), quantity: number(data, "quantity"),
        recurrence: recurring ? { frequency: text(data, "frequency"), interval: number(data, "interval"), count: number(data, "count"), ...(text(data, "until") ? { until: text(data, "until") } : {}) } : null,
        skipConflicts: data.has("skipConflicts"), ...(canOverride ? overrideInput(data) : {}),
      })} onSuccess={(result) => setHold({ bookingId: result.bookingId, reference: result.reference, holdExpiresAt: result.holdExpiresAt, skipped: result.conflicts.length })}>
        <Field label="Space"><Dropdown value={spaceId} onChange={(event) => setSpaceId(event.target.value)}>{spaces.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</Dropdown></Field>
        <p className="text-ink-muted">Capacity {space.capacity} per unit · {space.units} units</p>
        <div className="grid gap-4 sm:grid-cols-2"><TextField name="start" label="Start" type="datetime-local" required /><TextField name="end" label="End" type="datetime-local" required />
          <TextField name="quantity" label="Quantity" type="number" value={1} min={1} max={space.units} required /></div>
        <div onChange={(event) => setRecurring((event.target as HTMLInputElement).checked)}><CheckField name="recurring" label="Repeat this booking" /></div>
        {recurring ? <div className="grid gap-4 sm:grid-cols-2"><SelectField name="frequency" label="Repeat" value="WEEKLY" options={["DAILY", "WEEKLY"]} />
          <TextField name="interval" label="Repeat every (days or weeks)" type="number" value={1} min={1} max={12} required />
          <TextField name="count" label="Maximum occurrences" type="number" value={4} min={1} max={104} required /><TextField name="until" label="Stop by local date (optional)" type="date" />
          <CheckField name="skipConflicts" label="Skip conflicting occurrences" /></div> : null}
        {canOverride ? <OverrideField /> : null}
      </ActionForm>
    </Card> : <>
      <Callout role="status">{hold.reference}: times held until {formatDayTime(hold.holdExpiresAt, timezone)}.{hold.skipped ? ` ${hold.skipped} conflicting occurrences skipped.` : ""}</Callout>
      <Card><CardHeader title="Customer and booking details" description="Member eligibility is checked against the email and each occurrence's date. Staff bookings are confirmed without customer approval." />
        <ActionForm guard label="Create booking" action={(data) => submitBooking({ makerspaceSlug: slug, bookingId: hold.bookingId,
          contact: { name: text(data, "name"), email: text(data, "email"), phone: text(data, "phone") || null }, attendees: number(data, "attendees"),
          purpose: text(data, "purpose"), internalNotes: text(data, "internalNotes"), payLater: data.has("payLater"), applyMemberRate: data.has("applyMemberRate"),
          addOns: addOns.filter((row) => !row.spaceId || row.spaceId === spaceId).filter((row) => number(data, `addOn-${row.id}`) > 0).map((row) => ({ addOnId: row.id, quantity: number(data, `addOn-${row.id}`) })),
        })} onSuccess={(result) => router.push(`/dashboard/${slug}/bookings/${result.bookingId}`)}>
          <div className="grid gap-4 sm:grid-cols-2"><TextField name="name" label="Customer name" required /><TextField name="email" label="Customer email" type="email" required />
            <TextField name="phone" label="Customer phone" type="tel" /><TextField name="attendees" label="Attendees" type="number" min={1} value={1} required /></div>
          <NotesField name="purpose" label="Purpose" maxLength={2000} /><NotesField name="internalNotes" label="Internal notes" />
          <CheckField name="applyMemberRate" label="Apply member rates when the email is eligible" checked />
          <CheckField name="payLater" label="Pay later (payment pending)" />
          {addOns.filter((row) => !row.spaceId || row.spaceId === spaceId).map((row) => <TextField key={row.id} name={`addOn-${row.id}`} label={`${row.name} · ${money(row.priceMinor, currency)} · ${words(row.unit)}`} type="number" min={0} max={100} value={0} />)}
        </ActionForm>
      </Card>
      <ActionForm label="Release hold" confirm="Release these booking times and start again?" action={() => cancelBooking({ makerspaceSlug: slug, bookingId: hold.bookingId, kind: "STAFF", reason: "Staff released the checkout hold" })} onSuccess={() => setHold(null)} />
    </>}
  </div>;
}
