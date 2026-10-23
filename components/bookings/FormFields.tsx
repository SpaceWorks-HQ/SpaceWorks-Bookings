"use client";

import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { words } from "@/lib/bookings/ui";

export function TextField({ name, label, value, type = "text", required = false, helper, disabled, min, max }: {
  name: string; label: string; value?: string | number | null; type?: string; required?: boolean; helper?: string; disabled?: boolean; min?: number; max?: number;
}) {
  return <Field label={label} helperText={helper}><Input name={name} type={type} defaultValue={value ?? ""} required={required} disabled={disabled} min={min} max={max} /></Field>;
}
export function NotesField({ name, label, value = "", maxLength = 4000 }: { name: string; label: string; value?: string; maxLength?: number }) {
  return <Field label={label}><Textarea name={name} defaultValue={value} maxLength={maxLength} /></Field>;
}
export function SelectField({ name, label, value, options, disabled }: {
  name: string; label: string; value?: string; options: readonly (string | { value: string; label: string })[]; disabled?: boolean;
}) {
  return <Field label={label}><Dropdown name={name} defaultValue={value ?? ""} disabled={disabled}>{options.map((item) => {
    const option = typeof item === "string" ? { value: item, label: words(item) } : item;
    return <option key={option.value} value={option.value}>{option.label}</option>;
  })}</Dropdown></Field>;
}
export function CheckField({ name, label, checked = false, disabled }: { name: string; label: string; checked?: boolean; disabled?: boolean }) {
  return <CheckboxField name={name} label={label} defaultChecked={checked} disabled={disabled} />;
}
export const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
export const number = (data: FormData, key: string) => Number(text(data, key));
