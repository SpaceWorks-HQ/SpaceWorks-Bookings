import { z } from "zod";
import { requireStaff, type StaffActor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx } from "@/lib/bookings/db";
import { invalidInput, invalidState, notFound, zodInputError } from "@/lib/bookings/errors";
import { recordAuditEvent } from "@/lib/audit";
import { cleanSkills } from "./rules";

/**
 * The technician directory (`repairs.manage`): staff technicians (team members with the TECHNICIAN role) and outside
 * contacts, each with skill tags and the channels they can be reached on. Changes are audited without contact details.
 */

const phone = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Use the full number with the country code");
export const technicianFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter an email address").max(320)]).default(""),
  phone: z.union([z.literal(""), phone]).default(""),
  whatsapp: z.union([z.literal(""), phone]).default(""),
  telegramChatId: z.union([z.literal(""), z.string().trim().regex(/^-?\d{3,20}$/, "Use the numeric chat ID")]).default(""),
  skills: z.array(z.string().max(60)).max(20).default([]),
  preferredChannel: z.enum(["EMAIL", "WHATSAPP", "TELEGRAM"]).default("EMAIL"),
  notes: z.string().trim().max(500).default(""),
});
export type TechnicianFields = z.input<typeof technicianFieldsSchema>;

const empty = (value: string) => value || null;

function columns(fields: z.output<typeof technicianFieldsSchema>) {
  return {
    name: fields.name, email: empty(fields.email), phone: empty(fields.phone), whatsapp: empty(fields.whatsapp), telegramChatId: empty(fields.telegramChatId),
    skills: cleanSkills(fields.skills), preferredChannel: fields.preferredChannel, notes: fields.notes,
  };
}

/** Add an outside technician; they need at least one way to be reached. */
export async function addExternalTechnician(input: { makerspaceId: string; actor: StaffActor; fields: unknown }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  const parsed = technicianFieldsSchema.safeParse(input.fields);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  const data = columns(parsed.data);
  if (!data.email && !data.whatsapp && !data.telegramChatId) throw invalidInput("Add an email address, a WhatsApp number or a Telegram chat ID.", { email: "Add a way to reach them" });
  return withTx(db, async (tx) => {
    const technician = await tx.technician.create({ data: { ...data, makerspaceId: input.makerspaceId, kind: "EXTERNAL" } });
    await recordAuditEvent({ action: "TECHNICIAN_ADDED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "Technician", targetId: technician.id, metadata: { kind: "EXTERNAL" }, client: tx });
    return technician;
  });
}

/** List a team member who has the TECHNICIAN role, so requests can be sent to them. */
export async function addStaffTechnician(input: { makerspaceId: string; actor: StaffActor; userId: string; skills: string[] }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  return withTx(db, async (tx) => {
    const member = await tx.teamMember.findFirst({ where: { makerspaceId: input.makerspaceId, userId: input.userId }, select: { role: true, user: { select: { name: true, email: true } } } });
    if (!member) throw notFound("Team member");
    if (member.role !== "TECHNICIAN") throw invalidState("Give them the technician role on the Team page first.");
    if (await tx.technician.findFirst({ where: { makerspaceId: input.makerspaceId, userId: input.userId }, select: { id: true } })) throw invalidState("They are already in the directory.");
    const technician = await tx.technician.create({
      data: { makerspaceId: input.makerspaceId, kind: "STAFF", userId: input.userId, name: member.user.name?.trim() || member.user.email || "Technician", email: member.user.email, skills: cleanSkills(input.skills) },
    });
    await recordAuditEvent({ action: "TECHNICIAN_ADDED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "Technician", targetId: technician.id, metadata: { kind: "STAFF" }, client: tx });
    return technician;
  });
}

/** Edit a directory entry (staff technicians keep their account's email) or switch it on or off. */
export async function updateTechnician(input: { makerspaceId: string; actor: StaffActor; technicianId: string; fields: unknown; active: boolean }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "repairs.manage");
  const parsed = technicianFieldsSchema.safeParse(input.fields);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  return withTx(db, async (tx) => {
    const current = await tx.technician.findFirst({ where: { id: input.technicianId, makerspaceId: input.makerspaceId } });
    if (!current) throw notFound("Technician");
    const data = columns(parsed.data);
    if (current.kind === "STAFF") data.email = current.email;
    else if (!data.email && !data.whatsapp && !data.telegramChatId) throw invalidInput("Add an email address, a WhatsApp number or a Telegram chat ID.", { email: "Add a way to reach them" });
    const technician = await tx.technician.update({ where: { id: current.id }, data: { ...data, active: input.active } });
    await recordAuditEvent({ action: "TECHNICIAN_UPDATED", actorUserId: input.actor.userId, makerspaceId: input.makerspaceId, targetType: "Technician", targetId: current.id, metadata: { active: input.active, wasActive: current.active }, client: tx });
    return technician;
  });
}
