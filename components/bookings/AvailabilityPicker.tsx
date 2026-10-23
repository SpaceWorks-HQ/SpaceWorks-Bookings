"use client";

import { useEffect, useState } from "react";
import { loadBookingAvailability } from "@/app/actions/booking-availability";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { durationChoices, navigateBookingDate } from "@/lib/bookings/publicUi";
import { formatTime } from "@/lib/format/datetime";

export type TimeChoice = { start: string; end: string; quantity: number };
export type PickerRules = { minDurationMinutes: number; maxDurationMinutes: number; slotStepMinutes: number };
type Props = { slug: string; spaceId: string; zone: string; today: string; units: number; rules: PickerRules;
  onChange: (choice: TimeChoice | null) => void; fixedQuantity?: number; owner?: { bookingId: string; manageToken?: string; occurrenceId?: string; holdExpiresAt?: number }; onHoldGone?: () => void };

export function AvailabilityPicker({ slug, spaceId, zone, today, units, rules, onChange, owner, fixedQuantity, onHoldGone }: Props) {
  const durations = durationChoices(rules.minDurationMinutes, rules.maxDurationMinutes, rules.slotStepMinutes);
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState(durations[0] ?? rules.minDurationMinutes);
  const [quantity, setQuantity] = useState(fixedQuantity ?? 1);
  const [starts, setStarts] = useState<Array<{ start: number; end: number }>>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("Loading available times…");
  const bookingId = owner?.bookingId, manageToken = owner?.manageToken, occurrenceId = owner?.occurrenceId;
  const holdExpiresAt = owner?.holdExpiresAt;
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        if (holdExpiresAt !== undefined && holdExpiresAt <= Date.now()) { onHoldGone?.(); return; }
        const result = await loadBookingAvailability({ makerspaceSlug: slug, spaceId, date, duration, quantity,
          ...(bookingId ? { bookingId, manageToken, occurrenceId } : {}) });
        if (stale) return;
        if (!result.ok && result.code === "HOLD_GONE") onHoldGone?.();
        setStarts(result.ok ? result.data ?? [] : []);
        setMessage(result.ok ? result.data?.length ? "Choose a start time." : "No free times for this duration and quantity. Try another date." : result.error);
      } catch { if (!stale) setMessage("Could not load availability. Try another date."); }
    }, 200);
    return () => { stale = true; clearTimeout(timer); };
  }, [slug, spaceId, date, duration, quantity, bookingId, manageToken, occurrenceId, holdExpiresAt, onHoldGone]);
  function reset() { setSelected(""); setStarts([]); setMessage("Loading available times…"); onChange(null); }
  return <fieldset className="flex flex-col gap-4"><legend className="mb-3 text-h3">Choose a time</legend>
    <p className="text-ink-secondary">All times are in {zone}.</p>
    <div className="flex items-end gap-2"><Button variant="secondary" disabled={date <= today} onClick={() => { reset(); setDate(navigateBookingDate(date, -1)); }}>Previous day</Button>
      <Field label="Date" className="flex-1"><Input type="date" min={today} value={date} onChange={(event) => { reset(); setDate(event.target.value); }} /></Field>
      <Button variant="secondary" disabled={!date} onClick={() => { reset(); setDate(navigateBookingDate(date, 1)); }}>Next day</Button></div>
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Duration"><Dropdown value={duration} onChange={(event) => { reset(); setDuration(Number(event.target.value)); }}>
      {durations.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</Dropdown></Field>
      {units > 1 ? <Field label="Quantity"><Input type="number" min={1} max={units} value={quantity} onChange={(event) => { reset(); setQuantity(Number(event.target.value)); }} /></Field> : null}</div>
    <p role="status">{message}</p>
    <div className="flex max-h-64 flex-wrap gap-2 overflow-auto" aria-label="Free start times">{starts.map((slot) => <Button key={slot.start} variant={selected === String(slot.start) ? "accent" : "secondary"}
      aria-pressed={selected === String(slot.start)} onClick={() => { setSelected(String(slot.start)); onChange({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), quantity }); }}>
      {formatTime(new Date(slot.start), zone)}</Button>)}</div>
  </fieldset>;
}
