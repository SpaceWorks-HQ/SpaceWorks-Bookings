"use client";

import { postFinanceEntry, reverseFinanceEntry } from "@/app/actions/finance";
import { ActionForm } from "@/components/bookings/ActionForm";
import { NotesField, SelectField, TextField, text } from "@/components/bookings/FormFields";
import { isCurrencyCode, parseAmount } from "@/lib/money/currencies";

const CATEGORIES = [
  { value: "OUT:RENT", label: "Rent (money out)" }, { value: "OUT:UTILITIES", label: "Utilities (money out)" }, { value: "OUT:SUPPLIES", label: "Supplies (money out)" },
  { value: "OUT:STAFF_COSTS", label: "Staff costs (money out)" }, { value: "OUT:OTHER_EXPENSE", label: "Other expense (money out)" }, { value: "IN:OTHER_INCOME", label: "Other income (money in)" },
];
const METHODS = [{ value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "UPI", label: "UPI" }, { value: "CASH", label: "Cash" }, { value: "OTHER", label: "Other" }];

/** Post other income or an expense by hand (rent, utilities…). Entries can't be edited; reverse one instead. */
export function ManualEntryForm({ makerspaceSlug, currency, today }: { makerspaceSlug: string; currency: string; today: string }) {
  return <ActionForm label="Post the entry" action={(data) => {
    const [direction, category] = text(data, "kind").split(":");
    const amountMinor = (isCurrencyCode(currency) ? parseAmount(text(data, "amount"), currency) : null) ?? Number.NaN;
    return postFinanceEntry({ makerspaceSlug, direction, category, amountMinor, method: text(data, "method"), reference: text(data, "reference") || null, occurredAt: text(data, "occurredAt"), note: text(data, "note") });
  }}>
    <SelectField name="kind" label="What it is" options={CATEGORIES} value="OUT:RENT" />
    <TextField name="amount" label={`Amount (${currency})`} required />
    <SelectField name="method" label="How" options={METHODS} value="BANK_TRANSFER" />
    <TextField name="reference" label="Reference (optional)" />
    <TextField name="occurredAt" label="Date" type="date" value={today} required />
    <NotesField name="note" label="What it was for" maxLength={500} />
  </ActionForm>;
}

export function ReverseEntryForm({ makerspaceSlug, entryId }: { makerspaceSlug: string; entryId: string }) {
  return <ActionForm label="Reverse" confirm="A reversing entry cancels this one out. Neither can be edited or removed." action={(data) => reverseFinanceEntry({ makerspaceSlug, entryId, reason: text(data, "reason") })}>
    <TextField name="reason" label="Why" required />
  </ActionForm>;
}
