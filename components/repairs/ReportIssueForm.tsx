"use client";

import { useState } from "react";
import { reportIssue } from "@/app/actions/repairs";
import { reportIssueFromBooking } from "@/app/actions/repairs-public";
import { ActionForm } from "@/components/bookings/ActionForm";
import { NotesField, SelectField, TextField, text } from "@/components/bookings/FormFields";
import { Callout } from "@/components/ui/display";
import { ISSUE_SEVERITIES, SEVERITY_LABELS } from "@/lib/repairs/rules";

const SEVERITIES = ISSUE_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABELS[value] }));

type Access = { makerspaceSlug: string; bookingId?: string; manageToken?: string };

/** Report a problem with a space: staff pick the space; a customer reports the space of their booking. */
export function ReportIssueForm(props: { staff: { makerspaceSlug: string; spaces: Array<{ id: string; name: string }> } } | { customer: Access }) {
  const [reported, setReported] = useState<string | null>(null);
  const fields = (data: FormData) => ({ title: text(data, "title"), description: text(data, "description"), severity: text(data, "severity") });
  return <div className="flex flex-col gap-4">
    {reported ? <Callout tone="success" title="Thanks, it's reported">Reference {reported}. The team will look at it.</Callout> : null}
    <ActionForm label="Report the issue" onSuccess={(data: { reference: string }) => setReported(data.reference)} action={(data) => ("staff" in props
      ? reportIssue({ makerspaceSlug: props.staff.makerspaceSlug, spaceId: text(data, "spaceId"), ...fields(data) })
      : reportIssueFromBooking({ ...props.customer, ...fields(data) }))}>
      {"staff" in props ? <SelectField name="spaceId" label="Space" options={props.staff.spaces.map((space) => ({ value: space.id, label: space.name }))} /> : null}
      <TextField name="title" label="What is wrong" required helper="For example: the AC doesn't cool, the projector won't turn on." />
      <NotesField name="description" label="Details (optional)" maxLength={2000} />
      <SelectField name="severity" label="How urgent" options={SEVERITIES} value="MEDIUM" />
    </ActionForm>
  </div>;
}
