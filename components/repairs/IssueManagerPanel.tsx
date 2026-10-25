"use client";

import { useMemo, useState } from "react";
import { assignTechnician, closeIssue, reopenIssue, sendRepairRequests, setOutOfService } from "@/app/actions/repairs";
import { ActionForm } from "@/components/bookings/ActionForm";
import { NotesField, SelectField, TextField, text } from "@/components/bookings/FormFields";
import { CheckboxField } from "@/components/ui/choice";
import { Field, Input } from "@/components/ui/field";

type Technician = { id: string; name: string; kind: string; skills: string[]; channels: string[] };

/** A bookings manager picks technicians to ask (filtered by skill), or gives the repair to one directly. */
export function RequestTechnicians({ makerspaceSlug, issueId, directory, canRequest }: { makerspaceSlug: string; issueId: string; directory: Technician[]; canRequest: boolean }) {
  const [skill, setSkill] = useState("");
  const shown = useMemo(() => {
    const wanted = skill.trim().toLowerCase();
    return wanted ? directory.filter((row) => row.skills.some((tag) => tag.includes(wanted)) || row.name.toLowerCase().includes(wanted)) : directory;
  }, [directory, skill]);
  if (directory.length === 0) return <p className="text-ink-secondary">Add technicians to the directory first.</p>;
  const scope = { makerspaceSlug, issueId };
  return <div className="flex flex-col gap-8">
    {canRequest ? <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Ask technicians</h3>
      <p className="text-ink-secondary">Each one gets the request by email, and by WhatsApp or Telegram when set up. The first to accept takes it.</p>
      <Field label="Filter by skill or name"><Input value={skill} onChange={(event) => setSkill(event.target.value)} placeholder="electrical, AC…" /></Field>
      <ActionForm label="Send the request" action={(data) => sendRepairRequests({ ...scope, technicianIds: data.getAll("technicianIds").map(String) })}>
        <div className="flex flex-col gap-2">{shown.map((row) => <CheckboxField key={row.id} name="technicianIds" value={row.id}
          label={`${row.name}${row.kind === "STAFF" ? " (team)" : ""}${row.skills.length ? ` · ${row.skills.join(", ")}` : ""}${row.channels.length ? ` · ${row.channels.join(", ")}` : ""}`} />)}</div>
      </ActionForm>
    </section> : null}
    <section className="flex flex-col gap-3"><h3 className="text-h4 text-ink">Assign directly</h3>
      <ActionForm label="Assign" action={(data) => assignTechnician({ ...scope, technicianId: text(data, "technicianId") })}>
        <SelectField name="technicianId" label="Technician" options={directory.map((row) => ({ value: row.id, label: row.name }))} />
      </ActionForm>
    </section>
  </div>;
}

/** Verify and close a fixed issue, or reopen it with a reason. */
export function VerifyIssue({ makerspaceSlug, issueId, status }: { makerspaceSlug: string; issueId: string; status: string }) {
  const scope = { makerspaceSlug, issueId };
  return <div className="flex flex-col gap-8">
    {status === "FIXED" ? <ActionForm label="Verify and close" action={() => closeIssue(scope)} confirm="Close the issue as fixed. Any out-of-service block on the space is lifted." /> : null}
    {status === "FIXED" || status === "CLOSED" ? <ActionForm label="Reopen" action={(data) => reopenIssue({ ...scope, reason: text(data, "reason") })}>
      <NotesField name="reason" label="What is still wrong" maxLength={500} />
    </ActionForm> : null}
  </div>;
}

/** Keep the space unbookable until a date while it is out of service, or lift the block. */
export function OutOfService({ makerspaceSlug, issueId, active }: { makerspaceSlug: string; issueId: string; active: boolean }) {
  const scope = { makerspaceSlug, issueId };
  return active
    ? <ActionForm label="Open the space for bookings" action={() => setOutOfService({ ...scope, until: null })} />
    : <ActionForm label="Block bookings" action={(data) => setOutOfService({ ...scope, until: text(data, "until") })}>
      <TextField name="until" label="Unbookable until (inclusive)" type="date" required helper="New bookings are refused until then; existing ones stay." />
    </ActionForm>;
}
