import { memberSchema } from "./schema";
export type { MemberInput } from "./schema";
import type { MakerspaceMember } from "@prisma/client";
import { z } from "zod";
import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx, type Tx } from "@/lib/bookings/db";
import { invalidInput, notFound, zodInputError } from "@/lib/bookings/errors";
import { MAX_CSV_BYTES, parseCsv } from "@/lib/csv";
import { saveSetting } from "@/lib/settingsAudit";
import { dateKey, fromDbDate, parseDateKey, toDbDate } from "@/lib/time/zoned";

/**
 * The member-rate list (`members.manage`). Emails are stored lowercased and unique per makerspace. A member rate
 * applies while the row is active and the booking's local date is on or before `validUntil` (no date = no end).
 * Audit rows record what changed but never the email, name or note.
 */

const PERSONAL = ["email", "name", "note"] as const;
const actorId = (actor: Actor) => (actor.kind === "STAFF" ? actor.userId : null);

const view = (row: MakerspaceMember | null) => (row ? { email: row.email, name: row.name, note: row.note, validUntil: row.validUntil ? dateKey(fromDbDate(row.validUntil)) : null, active: row.active } : null);

async function upsertOne(tx: Tx, makerspaceId: string, actor: Actor, data: z.output<typeof memberSchema>) {
  const before = await tx.makerspaceMember.findUnique({ where: { makerspaceId_email: { makerspaceId, email: data.email } } });
  const values = { name: data.name, note: data.note, active: data.active, validUntil: data.validUntil ? toDbDate(parseDateKey(data.validUntil)!) : null };
  const member = before ? await tx.makerspaceMember.update({ where: { id: before.id }, data: values }) : await tx.makerspaceMember.create({ data: { ...values, email: data.email, makerspaceId } });
  await saveSetting(tx, { area: "member", makerspaceId, targetType: "MakerspaceMember", targetId: member.id, before: view(before), after: view(member), actorUserId: actorId(actor), redact: PERSONAL });
  return member;
}

/** Add or update one member by email (also the API upsert in Phase 3). */
export async function upsertMember(input: { makerspaceId: string; actor: Actor; member: unknown }, db: DbOrTx = defaultDb()): Promise<MakerspaceMember> {
  requireStaff(input.actor, "members.manage");
  const parsed = memberSchema.safeParse(input.member);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  return withTx(db, (tx) => upsertOne(tx, input.makerspaceId, input.actor, parsed.data));
}

export async function removeMember(input: { makerspaceId: string; actor: Actor; memberId: string }, db: DbOrTx = defaultDb()): Promise<void> {
  requireStaff(input.actor, "members.manage");
  await withTx(db, async (tx) => {
    const before = await tx.makerspaceMember.findFirst({ where: { id: input.memberId, makerspaceId: input.makerspaceId } });
    if (!before) throw notFound("Member");
    await tx.makerspaceMember.delete({ where: { id: before.id } });
    await saveSetting(tx, { area: "member", makerspaceId: input.makerspaceId, targetType: "MakerspaceMember", targetId: before.id, before: view(before), after: null, actorUserId: actorId(input.actor), redact: PERSONAL });
  });
}

export type MemberImportResult = { imported: number; errors: Array<{ line: number; message: string }> };

/**
 * Import a CSV with a header row: email (required), name, valid_until (YYYY-MM-DD), note. Existing emails are
 * updated. Nothing is saved if any row is invalid.
 */
export async function importMembersCsv(input: { makerspaceId: string; actor: Actor; csv: string }, db: DbOrTx = defaultDb()): Promise<MemberImportResult> {
  requireStaff(input.actor, "members.manage");
  if (Buffer.byteLength(input.csv, "utf8") > MAX_CSV_BYTES) throw invalidInput("The file is too large (2 MB at most).");
  const [header, ...rows] = parseCsv(input.csv, 5000);
  const columns = (header ?? []).map((cell) => cell.trim().toLowerCase().replace(/\s+/g, "_"));
  const at = (name: string) => columns.indexOf(name);
  if (at("email") < 0) throw invalidInput("The first row must name the columns, including email.");
  const errors: MemberImportResult["errors"] = [];
  const members: Array<z.output<typeof memberSchema>> = [];
  rows.forEach((row, index) => {
    if (row.every((cell) => !cell.trim())) return;
    const cell = (name: string) => (at(name) >= 0 ? (row[at(name)] ?? "").trim() : "");
    const parsed = memberSchema.safeParse({ email: cell("email"), name: cell("name"), validUntil: cell("valid_until") || null, note: cell("note") });
    if (parsed.success) members.push(parsed.data);
    else errors.push({ line: index + 2, message: parsed.error.issues[0]?.message ?? "Invalid row" });
  });
  if (errors.length) return { imported: 0, errors };
  await withTx(db, async (tx) => {
    for (const member of members) await upsertOne(tx, input.makerspaceId, input.actor, member);
  });
  return { imported: members.length, errors: [] };
}
