"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { minuteText, parseMinute } from "@/lib/bookings/ui";

export type Interval = { openMinute: number; closeMinute: number };
export function IntervalsEditor({ value, onChange, label }: { value: Interval[]; onChange: (value: Interval[]) => void; label: string }) {
  return <div className="flex flex-col gap-3">
    {value.map((row, index) => <div className="flex flex-wrap items-end gap-2" key={`${index}-${row.openMinute}-${row.closeMinute}`}>
      <Field label={`${label} opening ${index + 1}`}><Input required pattern="[0-2][0-9]:[0-5][0-9]" aria-label={`${label} opening ${index + 1}`}
        defaultValue={minuteText(row.openMinute)} onBlur={(event) => { try { const openMinute = parseMinute(event.target.value); event.target.setCustomValidity(""); onChange(value.map((item, i) => i === index ? { ...item, openMinute } : item)); } catch { event.target.setCustomValidity("Enter a valid opening time."); } }} /></Field>
      <Field label={`${label} closing ${index + 1}`} helperText="Use 24:00 for midnight."><Input required pattern="[0-2][0-9]:[0-5][0-9]" defaultValue={minuteText(row.closeMinute)}
        onBlur={(event) => { try { const closeMinute = parseMinute(event.target.value, true); event.target.setCustomValidity(""); onChange(value.map((item, i) => i === index ? { ...item, closeMinute } : item)); } catch { event.target.setCustomValidity("Enter a closing time up to 24:00."); } }} /></Field>
      <Button type="button" variant="quiet" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove interval {index + 1}</Button>
    </div>)}
    <div><Button type="button" variant="secondary" onClick={() => onChange([...value, { openMinute: 540, closeMinute: 1020 }])}>Add interval</Button></div>
  </div>;
}
