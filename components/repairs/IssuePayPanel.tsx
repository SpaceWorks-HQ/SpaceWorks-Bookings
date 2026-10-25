"use client";

import { approveRepairAmount, recordRepairPayout } from "@/app/actions/repairs";
import { ActionForm } from "@/components/bookings/ActionForm";
import { NotesField, SelectField, TextField, text } from "@/components/bookings/FormFields";
import { isCurrencyCode, money, parseAmount, toInputValue } from "@/lib/money/currencies";

const METHODS = [{ value: "CASH", label: "Cash" }, { value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "UPI", label: "UPI" }, { value: "OTHER", label: "Other" }];
const input = (minor: number | null, currency: string) => (minor === null ? "" : isCurrencyCode(currency) ? toInputValue(minor, currency) : String(minor));
const minor = (data: FormData, key: string, currency: string) => (isCurrencyCode(currency) ? parseAmount(text(data, key), currency) : null) ?? Number.NaN;

/** Approve what the repair costs, then record payouts until it is paid (bookings managers only). */
export function IssuePayPanel({ makerspaceSlug, issueId, currency, amountAskedMinor, approvedMinor, paidMinor, today }: {
  makerspaceSlug: string; issueId: string; currency: string; amountAskedMinor: number | null; approvedMinor: number | null; paidMinor: number; today: string;
}) {
  const scope = { makerspaceSlug, issueId };
  const left = approvedMinor === null ? 0 : approvedMinor - paidMinor;
  return <div className="flex flex-col gap-8">
    <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">{approvedMinor === null ? "Approve the amount" : "Change the approved amount"}</h3>
      <p className="text-ink-secondary">{amountAskedMinor === null ? "The technician didn't ask for an amount." : `The technician asked for ${money(amountAskedMinor, currency)}.`}</p>
      <ActionForm label="Approve" action={(data) => approveRepairAmount({ ...scope, amountMinor: minor(data, "amount", currency), note: text(data, "note") })}>
        <TextField name="amount" label={`Amount to pay (${currency})`} value={input(approvedMinor ?? amountAskedMinor, currency)} required />
        <NotesField name="note" label="Note (needed when it differs from what was asked)" maxLength={500} />
      </ActionForm>
    </section>
    {approvedMinor !== null && left > 0 ? <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Record a payout</h3>
      <p className="text-ink-secondary">{money(left, currency)} is left to pay. Payouts can&rsquo;t be edited afterwards.</p>
      <ActionForm label="Record the payout" action={(data) => recordRepairPayout({ ...scope, amountMinor: minor(data, "amount", currency), method: text(data, "method"), reference: text(data, "reference") || null, paidAt: text(data, "paidAt"), note: text(data, "note") })}>
        <TextField name="amount" label={`Amount (${currency})`} value={input(left, currency)} required />
        <SelectField name="method" label="Paid by" options={METHODS} value="BANK_TRANSFER" />
        <TextField name="reference" label="Reference (UTR, UPI or cheque number; not needed for cash)" />
        <TextField name="paidAt" label="Paid on" type="date" value={today} required />
        <NotesField name="note" label="Note (optional)" maxLength={500} />
      </ActionForm>
    </section> : null}
  </div>;
}
