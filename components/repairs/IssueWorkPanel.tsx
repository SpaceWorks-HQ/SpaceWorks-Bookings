"use client";

import { answerRepairRequest, recordRepairFix, addIssuePhoto } from "@/app/actions/repairs";
import { answerRepairLink, recordFixByLink, addPhotoByLink } from "@/app/actions/repairs-public";
import { ActionForm } from "@/components/bookings/ActionForm";
import { NotesField, TextField, text } from "@/components/bookings/FormFields";
import { Field, Input } from "@/components/ui/field";
import { isCurrencyCode, parseAmount, toInputValue } from "@/lib/money/currencies";

export type WorkMode = { kind: "staff"; makerspaceSlug: string; issueId: string } | { kind: "link"; token: string };

function amount(data: FormData, currency: string) {
  const value = text(data, "amount");
  if (!value) return null;
  return (isCurrencyCode(currency) ? parseAmount(value, currency) : null) ?? Number.NaN;
}

/** Answer a repair request. The first technician to accept takes it. */
export function AnswerRequest({ mode }: { mode: WorkMode }) {
  const answer = (value: "ACCEPT" | "DECLINE") => () => (mode.kind === "staff" ? answerRepairRequest({ makerspaceSlug: mode.makerspaceSlug, issueId: mode.issueId, answer: value }) : answerRepairLink({ token: mode.token, answer: value }));
  return <div className="flex flex-wrap gap-6">
    <ActionForm label="Accept the repair" action={answer("ACCEPT")} />
    <ActionForm label="Decline" action={answer("DECLINE")} confirm="The makerspace will ask someone else." />
  </div>;
}

/** Record what was done, the parts and what you ask for the work; marks the issue fixed for the makerspace to check. */
export function RecordFix({ mode, currency, remarks, partsUsed, amountAskedMinor, amountLocked }: {
  mode: WorkMode; currency: string; remarks: string; partsUsed: string; amountAskedMinor: number | null; amountLocked: boolean;
}) {
  const asked = amountAskedMinor === null ? "" : isCurrencyCode(currency) ? toInputValue(amountAskedMinor, currency) : String(amountAskedMinor);
  return <ActionForm label="Mark as fixed" action={(data) => {
    const fields = { remarks: text(data, "remarks"), partsUsed: text(data, "partsUsed"), amountAskedMinor: amountLocked ? amountAskedMinor : amount(data, currency) };
    return mode.kind === "staff" ? recordRepairFix({ makerspaceSlug: mode.makerspaceSlug, issueId: mode.issueId, ...fields }) : recordFixByLink({ token: mode.token, ...fields });
  }}>
    <NotesField name="remarks" label="What you did" value={remarks} maxLength={2000} />
    <NotesField name="partsUsed" label="Parts used (optional)" value={partsUsed} maxLength={1000} />
    <TextField name="amount" label={`What you ask for the work (${currency})`} value={asked} disabled={amountLocked}
      helper={amountLocked ? "The makerspace has approved the amount." : "Leave empty if there is no charge."} />
  </ActionForm>;
}

/** Add a photo of the problem or the repair (JPEG, PNG or WebP, up to 10 MB). */
export function AddPhoto({ mode }: { mode: WorkMode }) {
  return <ActionForm label="Add the photo" action={(data) => {
    if (mode.kind === "staff") { data.set("makerspaceSlug", mode.makerspaceSlug); data.set("issueId", mode.issueId); return addIssuePhoto(data); }
    data.set("token", mode.token);
    return addPhotoByLink(data);
  }}>
    <Field label="Photo"><Input name="file" type="file" accept="image/jpeg,image/png,image/webp" required /></Field>
  </ActionForm>;
}
