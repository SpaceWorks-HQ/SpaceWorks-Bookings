"use client";

import { approveBooking, declineBooking, cancelBooking, moveBooking } from "@/app/actions/bookings-staff";
import { ActionForm } from "./ActionForm";
import { SelectField, TextField, text } from "./FormFields";
import { OverrideField, overrideInput } from "./OverrideField";
import { Card, CardHeader } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";

type Occurrence = { id: string; startsAt: string; slotIndex: number; status: string };
export function BookingActions({ slug, booking, spaces, canManage, canApprove, canOverride, timezone }: {
  slug: string; booking: { id: string; status: string; spaceId: string; occurrences: Occurrence[] };
  spaces: Array<{ id: string; name: string }>; canManage: boolean; canApprove: boolean; canOverride: boolean; timezone: string;
}) {
  const scope = { makerspaceSlug: slug, bookingId: booking.id };
  const live = ["HELD", "REQUESTED", "CONFIRMED"].includes(booking.status);
  const slots = booking.occurrences.filter((row, i, rows) => row.status === "SCHEDULED" && rows.findIndex((item) => item.slotIndex === row.slotIndex) === i);
  return <div className="flex flex-col gap-6">
    {canApprove && booking.status === "REQUESTED" ? <Card><CardHeader title="Approval" description="Approve the whole series. Payment is requested only after approval." />
      <ActionForm label="Approve booking" action={(data) => approveBooking({ ...scope, ...(canOverride ? overrideInput(data) : {}) })}>
        {canOverride ? <OverrideField /> : null}
      </ActionForm>
      <div className="mt-6"><ActionForm label="Decline booking" confirm="Decline this request and release its reserved times?" action={(data) => declineBooking({ ...scope, reason: text(data, "reason") })}>
        <TextField name="reason" label="Reason for declining" required />
      </ActionForm></div>
    </Card> : null}
    {canManage && live ? <Card><CardHeader title="Cancel booking" description="Cancelling for the customer applies their frozen cancellation policy. A venue cancellation refunds everything paid." />
      <ActionForm label="Cancel booking" confirm="Cancel the selected occurrences? Their cancellation terms will be applied." action={(data) => {
        const value = text(data, "scope"); const [type, occurrenceId] = value.split(":");
        return cancelBooking({ ...scope, kind: text(data, "kind"), reason: text(data, "reason"), scope: type === "ALL" ? { type: "ALL" } : { type, occurrenceId } });
      }}>
        <SelectField name="kind" label="Cancellation type" value="STAFF" options={[{ value: "STAFF", label: "For the customer (policy applies)" }, ...(canOverride ? [{ value: "VENUE", label: "Venue cancellation (100% refund)" }] : [])]} />
        <SelectField name="scope" label="Occurrences to cancel" value="ALL" options={[{ value: "ALL", label: "Whole booking" }, ...slots.flatMap((row) => [
          { value: `OCCURRENCE:${row.id}`, label: `Only ${formatDayTime(row.startsAt, timezone)}` }, { value: `FOLLOWING:${row.id}`, label: `${formatDayTime(row.startsAt, timezone)} and following` },
        ])]} />
        <TextField name="reason" label="Cancellation reason (required for venue cancellation)" />
      </ActionForm>
    </Card> : null}
    {canManage && ["REQUESTED", "CONFIRMED"].includes(booking.status) ? <Card><CardHeader title="Move to another space" description="Moves the booking's upcoming occurrences and checks availability in the destination space." />
      <ActionForm guard label="Move booking" action={(data) => moveBooking({ ...scope, toSpaceId: text(data, "toSpaceId"), ...(canOverride ? overrideInput(data) : {}) })}>
        <SelectField name="toSpaceId" label="Destination space" options={[{ value: "", label: "Choose a space" }, ...spaces.filter((row) => row.id !== booking.spaceId).map((row) => ({ value: row.id, label: row.name }))]} />
        {canOverride ? <OverrideField /> : null}
      </ActionForm>
    </Card> : null}
  </div>;
}
