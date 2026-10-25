"use client";

import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { words } from "@/lib/bookings/ui";
import { isCurrencyCode, parseAmount, toInputValue } from "@/lib/money/currencies";

export function TextField({ name, label, value, type = "text", required = false, helper, disabled, min, max, step, inputMode }: {
  name: string; label: string; value?: string | number | null; type?: string; required?: boolean; helper?: string; disabled?: boolean; min?: number; max?: number;
  step?: number | "any"; inputMode?: "decimal" | "numeric";
}) {
  return <Field label={label} helperText={helper}><Input name={name} type={type} defaultValue={value ?? ""} required={required} disabled={disabled} min={min} max={max} step={step} inputMode={inputMode} /></Field>;
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
/** A typed percentage ("18", "12.5") as basis points; NaN when it is not a number, so the action reports it. */
export const percentBps = (data: FormData, key: string) => Math.round(Number(text(data, key)) * 100);
/** Basis points shown as a plain percentage in an input (1250 becomes "12.5"). */
export const bpsInput = (bps: number | null | undefined) => (bps === null || bps === undefined ? "" : String(bps / 100));
/** An amount typed in the currency's main unit ("800", "800.50") as minor units; NaN when it is not valid. */
export const amountMinor = (value: string, currency: string) => (isCurrencyCode(currency) ? parseAmount(value, currency) ?? Number.NaN : Number(value));
/** Minor units shown in the currency's main unit in an input (80000 INR becomes "800.00"). */
export const amountInput = (minor: number | null | undefined, currency: string) => (minor === null || minor === undefined ? "" : isCurrencyCode(currency) ? toInputValue(minor, currency) : String(minor));
