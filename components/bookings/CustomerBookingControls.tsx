"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelBooking, cancelByManageToken, rescheduleOccurrence, rescheduleByManageToken } from "@/app/actions/bookings-public";
import type { cancellationPreview } from "@/lib/bookings/cancellationPreview";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Dropdown, Input } from "@/components/ui/field";
import { money } from "@/lib/money/currencies";
import { formatDate, formatTime } from "@/lib/format/datetime";
import { AvailabilityPicker, type PickerRules, type TimeChoice } from "./AvailabilityPicker";

type Preview = ReturnType<typeof cancellationPreview>;
type Props = { slug: string; bookingId: string; manageToken?: string; currency: string; cancellations: Preview[];
  slots: Array<{ id: string; startsAt: string; canMove: boolean }>; spaceId: string; units: number; zone: string; today: string; rules: PickerRules };
export function CustomerBookingControls(props: Props) {
  const { slug, bookingId, manageToken, currency } = props;
  const router = useRouter();
  const [scope, setScope] = useState("0");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [moving, setMoving] = useState("");
  const [time, setTime] = useState<TimeChoice | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const preview = props.cancellations[Number(scope)];
  const access = { makerspaceSlug: slug, ...(manageToken ? { manageToken } : { bookingId }) };
  const label = (item: Preview) => {
    if (item.scope.type === "ALL") return "All remaining times";
    const id = item.scope.occurrenceId;
    const slot = props.slots.find((row) => row.id === id)!;
    return `${item.scope.type === "FOLLOWING" ? "This and following: " : "This time: "}${formatDate(new Date(slot.startsAt), props.zone)}, ${formatTime(new Date(slot.startsAt), props.zone)}`;
  };
  return <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
    {props.cancellations.some((item) => item.allowed) ? <section className="flex flex-col gap-3"><h2 className="text-h2">Cancel booking</h2>
      <Field label="Times to cancel"><Dropdown value={scope} disabled={pending} onChange={(event) => { setScope(event.target.value); setConfirm(false); }}>
        {props.cancellations.map((item, index) => <option key={index} value={index} disabled={!item.allowed}>{label(item)}</option>)}</Dropdown></Field>
      <Field label="Reason" optional><Input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></Field>
      {confirm ? <Callout tone="warning" title="Review cancellation"><p>The policy keeps {money(preview.keptMinor, currency)}. Your booking will owe {money(preview.chargeMinor, currency)} in total after this cancellation.</p>
        <p>Refund due: {money(preview.refundMinor, currency)}. Balance due: {money(preview.balanceMinor, currency)}.</p>
        <p className="mt-2">This estimate uses the policy at the time this page opened. Time-based cutoffs still apply when you confirm.</p>
        <div className="mt-3 flex gap-3"><Button variant="dangerSolid" disabled={pending || !preview.allowed} onClick={() => { setError(""); startTransition(async () => {
          try {
            const input = { ...access, scope: preview.scope, reason };
            const result = await (manageToken ? cancelByManageToken(input) : cancelBooking(input));
            if (!result.ok) { setError(result.error); return; }
            setConfirm(false); router.refresh();
          } catch { setError("Could not cancel your booking. Please try again."); }
        }); }}>Confirm cancellation</Button><Button onClick={() => setConfirm(false)} disabled={pending}>Keep booking</Button></div></Callout>
        : <Button variant="danger" disabled={pending || !preview.allowed} onClick={() => setConfirm(true)}>Review cancellation</Button>}
    </section> : <p>To discuss cancellation, contact the makerspace.</p>}
    {props.slots.some((row) => row.canMove) ? <section className="flex flex-col gap-4"><h2 className="text-h2">Reschedule</h2>
      <Field label="Time to move"><Dropdown value={moving} disabled={pending} onChange={(event) => { setMoving(event.target.value); setTime(null); }}><option value="">Choose a time</option>
        {props.slots.filter((row) => row.canMove).map((row) => <option key={row.id} value={row.id}>{formatDate(new Date(row.startsAt), props.zone)}, {formatTime(new Date(row.startsAt), props.zone)}</option>)}</Dropdown></Field>
      {moving ? <><AvailabilityPicker key={moving} slug={slug} spaceId={props.spaceId} units={1} fixedQuantity={props.units} zone={props.zone} today={props.today} rules={props.rules}
        owner={{ bookingId, manageToken, occurrenceId: moving }} onChange={setTime} />
        <p>All units of this time will move together. The booking is repriced at current rates using your original rate kind and tax. The original cancellation policy still applies.</p>
        <Button disabled={!time || pending} onClick={() => { setError(""); startTransition(async () => {
          if (!time) return;
          try {
            const input = { ...access, occurrenceId: moving, start: time.start, end: time.end };
            const result = await (manageToken ? rescheduleByManageToken(input) : rescheduleOccurrence(input));
            if (!result.ok) { setError(result.error); return; }
            setMoving(""); setTime(null); router.refresh();
          } catch { setError("Could not move your booking. Please try again."); }
        }); }}>Move booking time</Button></> : null}
    </section> : null}
    {error ? <Callout role="alert" tone="danger">{error}</Callout> : null}
  </fieldset>;
}
