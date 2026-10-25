"use client";

import { recordBookingPayment, refundBooking, writeOffBooking, changePaymentDueDate } from "@/app/actions/booking-money";
import { ActionForm } from "../ActionForm";
import { SelectField, TextField, text } from "../FormFields";
import { OFFLINE_METHODS, OFFLINE_METHOD_LABELS } from "@/lib/payments/offline-methods";
import { isCurrencyCode, parseAmount, toInputValue } from "@/lib/money/currencies";
import { money } from "@/lib/money/currencies";

const METHODS = OFFLINE_METHODS.map((value) => ({ value, label: OFFLINE_METHOD_LABELS[value] }));

/** Turn a typed amount ("1,250.50") into minor units, or NaN so the action reports it. */
function minor(data: FormData, key: string, currency: string) {
  const value = text(data, key);
  if (!value) return undefined;
  return (isCurrencyCode(currency) ? parseAmount(value, currency) : null) ?? Number.NaN;
}

const localInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");

export function MoneyActions({ slug, bookingId, currency, status, dueMinor, paymentDueAt, canRecord, canRefund, canChangeDue, writtenOff, timezone }: {
  slug: string; bookingId: string; currency: string; status: string; dueMinor: number; paymentDueAt: string | null;
  canRecord: boolean; canRefund: boolean; canChangeDue: boolean; writtenOff: boolean; timezone: string;
}) {
  const scope = { makerspaceSlug: slug, bookingId };
  const owed = dueMinor > 0 && !writtenOff;
  const due = isCurrencyCode(currency) ? toInputValue(dueMinor, currency) : String(dueMinor);
  return <div className="mt-6 flex flex-col gap-8">
    {canRecord && owed ? <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Record a payment</h3>
      <p className="text-ink-secondary">Money taken at the desk, by UPI or bank transfer. {money(dueMinor, currency)} is due.</p>
      <ActionForm guard label="Record payment" action={(data) => recordBookingPayment({ ...scope, amountMinor: minor(data, "amount", currency), method: text(data, "method"), utr: text(data, "utr"), reference: text(data, "reference"), note: text(data, "note") })}>
        <TextField name="amount" label={`Amount (${currency})`} value={due} required />
        <SelectField name="method" label="Method" value="cash" options={METHODS} />
        <TextField name="utr" label="UPI or bank reference (UTR)" helper="Recorded once per makerspace." />
        <TextField name="reference" label="Receipt book or other reference" />
        <TextField name="note" label="Note" />
      </ActionForm>
    </section> : null}
    {canRefund ? <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Refund</h3>
      <p className="text-ink-secondary">Gives money back through the way it was paid where the provider allows; cash goes back at the desk. Beyond what is due, the charge drops by the same amount.</p>
      <ActionForm guard label="Refund" confirm="Send this refund? It can't be undone." action={(data) => refundBooking({ ...scope, amountMinor: minor(data, "amount", currency), reason: text(data, "reason") })}>
        <TextField name="amount" label={`Amount (${currency})`} required />
        <TextField name="reason" label="Reason" required />
      </ActionForm>
    </section> : null}
    {canChangeDue && status === "CONFIRMED" && owed ? <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Payment due date</h3>
      <ActionForm guard label="Change due date" action={(data) => changePaymentDueDate({ ...scope, dueAt: text(data, "dueAt") ? new Date(text(data, "dueAt")).toISOString() : "" })}>
        <TextField name="dueAt" type="datetime-local" label={`Due (${timezone}, shown in your browser's time)`} value={localInput(paymentDueAt)} required />
      </ActionForm>
    </section> : null}
    {canRefund && owed ? <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Write off</h3>
      <p className="text-ink-secondary">Stop asking for the {money(dueMinor, currency)} still owed.</p>
      <ActionForm label="Write off" confirm="Stop asking the customer for what they still owe?" action={(data) => writeOffBooking({ ...scope, reason: text(data, "reason") })}>
        <TextField name="reason" label="Reason" required />
      </ActionForm>
    </section> : null}
  </div>;
}
