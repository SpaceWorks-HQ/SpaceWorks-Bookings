"use client";

import { retryBookingRefund, recordBookingRefundOffline } from "@/app/actions/booking-money";
import { ActionForm } from "../ActionForm";
import { SelectField, TextField, text } from "../FormFields";
import { OFFLINE_METHODS, OFFLINE_METHOD_LABELS } from "@/lib/payments/offline-methods";

const METHODS = OFFLINE_METHODS.map((value) => ({ value, label: OFFLINE_METHOD_LABELS[value] }));

/** Retry a failed gateway refund, or record money handed back outside the gateway. */
export function RefundRowActions({ slug, bookingId, refundId, canRetry, canRecordOffline }: { slug: string; bookingId: string; refundId: string; canRetry: boolean; canRecordOffline: boolean }) {
  if (!canRetry && !canRecordOffline) return null;
  const scope = { makerspaceSlug: slug, bookingId, refundId };
  return <div className="flex flex-col gap-4 rounded-lg border border-line p-4 sm:flex-row sm:items-start">
    {canRetry ? <div className="sm:w-1/3"><ActionForm label="Retry refund" action={() => retryBookingRefund(scope)} /></div> : null}
    {canRecordOffline ? <div className="flex-1"><ActionForm label="Record as handed back" action={(data) => recordBookingRefundOffline({ ...scope, method: text(data, "method"), reference: text(data, "reference") })}>
      <SelectField name="method" label="How it went back" value="bank_transfer" options={METHODS} />
      <TextField name="reference" label="Reference" helper="A UTR, cheque number or who handed the cash back." required />
    </ActionForm></div> : null}
  </div>;
}
