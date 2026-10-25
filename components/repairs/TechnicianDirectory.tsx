"use client";

import { addExternalTechnician, addStaffTechnician, updateTechnician } from "@/app/actions/technicians";
import { ActionForm } from "@/components/bookings/ActionForm";
import { CheckField, NotesField, SelectField, TextField, text } from "@/components/bookings/FormFields";
import { Card, Chip, EmptyState } from "@/components/ui/display";

type Technician = {
  id: string; kind: string; name: string; email: string; phone: string; whatsapp: string; telegramChatId: string;
  skills: string[]; preferredChannel: string; notes: string; active: boolean;
};
const CHANNELS = [{ value: "EMAIL", label: "Email" }, { value: "WHATSAPP", label: "WhatsApp" }, { value: "TELEGRAM", label: "Telegram" }];
const skillList = (data: FormData) => text(data, "skills").split(",").map((tag) => tag.trim()).filter(Boolean);
const fields = (data: FormData) => ({
  name: text(data, "name"), email: text(data, "email"), phone: text(data, "phone"), whatsapp: text(data, "whatsapp"), telegramChatId: text(data, "telegramChatId"),
  skills: skillList(data), preferredChannel: text(data, "preferredChannel"), notes: text(data, "notes"),
});

function ContactFields({ value, staff }: { value?: Technician; staff?: boolean }) {
  return <>
    <TextField name="name" label="Name" value={value?.name} required />
    {staff ? null : <TextField name="email" label="Email (optional)" type="email" value={value?.email} />}
    <TextField name="phone" label="Phone (optional)" value={value?.phone} />
    <TextField name="whatsapp" label="WhatsApp number (optional)" value={value?.whatsapp} helper="With the country code, for example +919847000000." />
    <TextField name="telegramChatId" label="Telegram chat ID (optional)" value={value?.telegramChatId} />
    <TextField name="skills" label="Skills" value={value?.skills.join(", ")} helper="Separate with commas: electrical, AC, plumbing, AV." />
    <SelectField name="preferredChannel" label="Prefers" options={CHANNELS} value={value?.preferredChannel ?? "EMAIL"} />
    <NotesField name="notes" label="Notes (optional)" value={value?.notes} maxLength={500} />
  </>;
}

/** The directory: every technician, editable; add outside contacts or team members with the technician role. */
export function TechnicianDirectory({ makerspaceSlug, technicians, unlisted }: { makerspaceSlug: string; technicians: Technician[]; unlisted: Array<{ userId: string; name: string }> }) {
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <div className="flex flex-col gap-4">
      {technicians.length === 0 ? <Card><EmptyState mood="sleepy" title="No technicians yet">Add the people you call when something breaks.</EmptyState></Card> : technicians.map((row) => <Card key={row.id} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-h3 text-ink">{row.name}</h2><Chip size="sm" tone={row.kind === "STAFF" ? "info" : "neutral"}>{row.kind === "STAFF" ? "Team" : "Outside"}</Chip>{row.active ? null : <Chip size="sm" tone="warning">Inactive</Chip>}</div>
        <p className="text-ink-secondary">{[row.skills.join(", "), row.email, row.whatsapp && `WhatsApp ${row.whatsapp}`, row.telegramChatId && "Telegram"].filter(Boolean).join(" · ") || "No details yet"}</p>
        <details><summary className="cursor-pointer text-ink underline underline-offset-4">Edit</summary>
          <div className="mt-4"><ActionForm label="Save" action={(data) => updateTechnician({ makerspaceSlug, technicianId: row.id, fields: { ...fields(data), email: row.kind === "STAFF" ? row.email : text(data, "email") }, active: data.get("active") === "on" })}>
            <ContactFields value={row} staff={row.kind === "STAFF"} />
            <CheckField name="active" label="Active (can be asked)" checked={row.active} />
          </ActionForm></div>
        </details>
      </Card>)}
    </div>
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3"><h2 className="text-h3 text-ink">Add an outside technician</h2>
        <ActionForm label="Add technician" action={(data) => addExternalTechnician({ makerspaceSlug, fields: fields(data) })}><ContactFields /></ActionForm>
      </Card>
      {unlisted.length ? <Card className="flex flex-col gap-3"><h2 className="text-h3 text-ink">Add a team technician</h2>
        <p className="text-ink-secondary">Team members with the technician role answer requests in the dashboard.</p>
        <ActionForm label="Add to the directory" action={(data) => addStaffTechnician({ makerspaceSlug, userId: text(data, "userId"), skills: skillList(data) })}>
          <SelectField name="userId" label="Team member" options={unlisted.map((member) => ({ value: member.userId, label: member.name }))} />
          <TextField name="skills" label="Skills" helper="Separate with commas." />
        </ActionForm>
      </Card> : null}
    </div>
  </div>;
}
