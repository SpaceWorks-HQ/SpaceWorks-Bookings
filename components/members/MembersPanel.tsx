"use client";

import { useState } from "react";
import { upsertMember, removeMember, importMembersCsv } from "@/app/actions/members";
import { ActionForm } from "@/components/bookings/ActionForm";
import { TextField, NotesField, CheckField, text } from "@/components/bookings/FormFields";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Chip, Callout, EmptyState } from "@/components/ui/display";

type Member = { id: string; name: string; email: string; validUntil: string | null; active: boolean; note: string };
export function MembersPanel({ slug, members }: { slug: string; members: Member[] }) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [report, setReport] = useState<{ imported: number; errors: Array<{ line: number; message: string }> } | null>(null);
  return <div className="flex flex-col gap-6">
    {!members.length ? <EmptyState title="No matching members">Add an email to offer member rates, or change your search.</EmptyState> : <Card>
      {members.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-3 border-b border-line py-4 last:border-0">
        <div className="min-w-0 flex-1 text-ink"><p className="break-words font-semibold">{member.name || member.email}</p><p className="break-words">{member.email}</p><p className="text-ink-muted">{member.validUntil ? `Valid through ${member.validUntil}` : "No end date"}</p></div>
        <Chip>{member.active ? "Active" : "Inactive"}</Chip><Button variant="secondary" onClick={() => setEditing(member)}>Edit member</Button>
        <ActionForm label="Remove member" confirm="Remove member-rate eligibility for this email? Existing bookings keep their rates." action={() => removeMember({ makerspaceSlug: slug, memberId: member.id })} />
      </div>)}
    </Card>}
    <Card><CardHeader title={editing ? "Edit member" : "Add member"} description="Email identifies the member. Rates are checked against each occurrence's local date." />
      <ActionForm guard key={editing?.id ?? "new"} label={editing ? "Save member" : "Add member"} onSuccess={() => setEditing(null)} action={(data) => upsertMember({ makerspaceSlug: slug, member: {
        email: editing?.email ?? text(data, "email"), name: text(data, "name"), validUntil: text(data, "validUntil") || null, active: data.has("active"), note: text(data, "note"),
      } })}>
        <div className="grid gap-4 sm:grid-cols-2"><TextField name="email" label="Email" type="email" value={editing?.email} required disabled={Boolean(editing)} />
          <TextField name="name" label="Customer name" value={editing?.name} /><TextField name="validUntil" label="Valid through (local date)" type="date" value={editing?.validUntil} /></div>
        <CheckField name="active" label="Active" checked={editing?.active ?? true} /><NotesField name="note" label="Note" value={editing?.note} maxLength={500} />
      </ActionForm>
      {editing ? <Button className="mt-3" variant="quiet" onClick={() => setEditing(null)}>Cancel editing</Button> : null}
    </Card>
    <Card><CardHeader title="Import CSV" description="Up to 2 MB and 5,000 rows. Columns: email, name, valid_until (YYYY-MM-DD), note. Existing emails are updated; invalid rows prevent the whole import." />
      {report ? <Callout tone={report.errors.length ? "danger" : "success"} role={report.errors.length ? "alert" : "status"}>
        {report.imported} imported.{report.errors.map((error) => <p key={error.line}>Line {error.line}: {error.message}</p>)}
      </Callout> : null}
      <ActionForm label="Import members" confirm="Import this file and update members whose emails already exist?" action={async (data) => {
        const file = data.get("file"); if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a CSV file." };
        if (file.size > 2 * 1024 * 1024) return { ok: false, error: "The file is too large (2 MB at most)." };
        return importMembersCsv({ makerspaceSlug: slug, csv: await file.text() });
      }} onSuccess={setReport}><TextField name="file" label="CSV file" type="file" required /></ActionForm>
    </Card>
  </div>;
}
