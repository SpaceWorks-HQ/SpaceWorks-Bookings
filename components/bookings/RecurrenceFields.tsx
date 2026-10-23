"use client";
import { Field, Input, Dropdown } from "@/components/ui/field";

export type RepeatChoice = { frequency: "DAILY" | "WEEKLY"; count?: number; until?: string } | null;
export function RecurrenceFields({ value, onChange, max, today }: { value: RepeatChoice; onChange: (value: RepeatChoice) => void; max: number; today: string }) {
  return <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-h3">Repeat</legend>
    <Field label="Frequency"><Dropdown value={value?.frequency ?? "NONE"} onChange={(event) => onChange(event.target.value === "NONE" ? null : { frequency: event.target.value as "DAILY" | "WEEKLY", count: Math.min(4, max) })}>
      <option value="NONE">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option></Dropdown></Field>
    {value ? <><Field label="End series"><Dropdown value={value.until !== undefined ? "UNTIL" : "COUNT"} onChange={(event) => onChange(event.target.value === "UNTIL" ? { frequency: value.frequency, until: today } : { frequency: value.frequency, count: Math.min(4, max) })}>
      <option value="COUNT">After a number of bookings</option><option value="UNTIL">On a date</option></Dropdown></Field>
      {value.until !== undefined ? <Field label="Until (inclusive)"><Input type="date" min={today} value={value.until} onChange={(event) => onChange({ frequency: value.frequency, until: event.target.value })} /></Field>
        : <Field label={`Number of bookings (up to ${max})`}><Input type="number" min={1} max={max} value={value.count ?? 1} onChange={(event) => onChange({ frequency: value.frequency, count: Number(event.target.value) })} /></Field>}</> : null}
  </fieldset>;
}
