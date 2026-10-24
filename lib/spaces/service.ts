import type { Prisma, Space } from "@prisma/client";
import { z } from "zod";
import { MONEY_SPACE_FIELDS } from "@/lib/bookingRules/schema";
import { requireStaff, type Actor } from "@/lib/bookings/actor";
import { defaultDb, withTx, type DbOrTx } from "@/lib/bookings/db";
import { invalidInput, notFound, zodInputError } from "@/lib/bookings/errors";
import { saveSetting } from "@/lib/settingsAudit";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";

/**
 * Spaces: details, rates, units and photos. `spaces.manage` for everything; the tax overrides (taxRateBps,
 * sacCode) also need `payments.settings`. Units can't drop below what upcoming bookings use. Spaces are archived,
 * never deleted, once booked. Every change is audited through saveSetting.
 */

const money = z.number().int().min(0).max(1_000_000_000).nullable();
export const spaceFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  slug: z.string().trim().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens"),
  kind: z.enum(["ROOM", "STUDIO", "DESK", "HALL", "OTHER"]),
  summary: z.string().trim().max(300),
  description: z.string().max(10_000),
  capacity: z.number().int().min(0).max(100_000),
  units: z.number().int().min(1).max(500),
  amenities: z.array(z.string().trim().min(1).max(60)).max(30),
  colour: z.string().regex(/^[a-z-]{1,30}$/).nullable(),
  published: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  publicHourlyMinor: money,
  publicHalfDayMinor: money,
  publicDayMinor: money,
  memberHourlyMinor: money,
  memberHalfDayMinor: money,
  memberDayMinor: money,
  halfDayMinutes: z.number().int().min(15).max(1440),
  dayMinutes: z.number().int().min(15).max(1440),
  taxRateBps: z.number().int().min(0).max(10_000).nullable(),
  sacCode: z.string().regex(/^[0-9]{4,8}$/, "A SAC is 4 to 8 digits").nullable(),
});
export type SpaceFields = z.infer<typeof spaceFieldsSchema>;
const createSchema = spaceFieldsSchema.partial().required({ name: true });
const updateSchema = spaceFieldsSchema.partial();

const AUDITED: Array<keyof Space> = ["name", "slug", "kind", "summary", "description", "capacity", "units", "amenities", "colour", "published", "sortOrder", "archivedAt", "publicHourlyMinor", "publicHalfDayMinor", "publicDayMinor", "memberHourlyMinor", "memberHalfDayMinor", "memberDayMinor", "halfDayMinutes", "dayMinutes", "taxRateBps", "sacCode"];
const snapshot = (space: Space) => Object.fromEntries(AUDITED.map((key) => [key, space[key]]));
const actorId = (actor: Actor) => (actor.kind === "STAFF" ? actor.userId : null);

function authorise(actor: Actor, fields: object) {
  requireStaff(actor, "spaces.manage");
  if (MONEY_SPACE_FIELDS.some((key) => key in fields)) requireStaff(actor, "payments.settings");
}

function checkBlocks(fields: Partial<SpaceFields>, current?: Space) {
  const half = fields.halfDayMinutes ?? current?.halfDayMinutes ?? 240;
  const day = fields.dayMinutes ?? current?.dayMinutes ?? 480;
  if (day < half) throw invalidInput("A day can't be shorter than a half day.", { dayMinutes: "Longer than the half day" });
}

export async function createSpace(input: { makerspaceId: string; actor: Actor; fields: unknown }, db: DbOrTx = defaultDb()): Promise<Space> {
  const parsed = createSchema.safeParse(input.fields);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  authorise(input.actor, parsed.data);
  checkBlocks(parsed.data);
  return withTx(db, async (tx) => {
    const base = parsed.data.slug ?? slugifyTitle(parsed.data.name).slice(0, 60);
    let slug = base;
    for (let suffix = 2; await tx.space.findFirst({ where: { makerspaceId: input.makerspaceId, slug }, select: { id: true } }); suffix += 1) slug = withSlugSuffix(base, suffix);
    const space = await tx.space.create({ data: { ...parsed.data, slug, makerspaceId: input.makerspaceId } });
    await saveSetting(tx, { area: "space", makerspaceId: input.makerspaceId, targetType: "Space", targetId: space.id, before: null, after: snapshot(space), actorUserId: actorId(input.actor) });
    return space;
  });
}

/** The highest unit index upcoming live bookings use, or -1. */
async function highestUnitInUse(db: DbOrTx, spaceId: string, now: Date): Promise<number> {
  const row = await db.bookingOccurrence.findFirst({ where: { spaceId, status: { in: ["SCHEDULED", "CHECKED_IN"] }, endsAt: { gt: now }, booking: { status: { in: ["HELD", "REQUESTED", "CONFIRMED"] } } }, orderBy: { unit: "desc" }, select: { unit: true } });
  return row?.unit ?? -1;
}

export async function updateSpace(input: { makerspaceId: string; spaceId: string; actor: Actor; fields: unknown; now?: Date }, db: DbOrTx = defaultDb()): Promise<Space> {
  const parsed = updateSchema.safeParse(input.fields);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  authorise(input.actor, parsed.data);
  return withTx(db, async (tx) => {
    const current = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId } });
    if (!current) throw notFound("Space");
    checkBlocks(parsed.data, current);
    if (parsed.data.units !== undefined && parsed.data.units < current.units) {
      const used = await highestUnitInUse(tx, current.id, input.now ?? new Date());
      if (used >= parsed.data.units) throw invalidInput(`Upcoming bookings use ${used + 1} units. Move or cancel them first.`, { units: `At least ${used + 1}` });
    }
    if (parsed.data.slug && parsed.data.slug !== current.slug && (await tx.space.findFirst({ where: { makerspaceId: input.makerspaceId, slug: parsed.data.slug }, select: { id: true } }))) {
      throw invalidInput("Another space uses that address.", { slug: "Already in use" });
    }
    const space = await tx.space.update({ where: { id: current.id }, data: parsed.data as Prisma.SpaceUpdateInput });
    await saveSetting(tx, { area: "space", makerspaceId: input.makerspaceId, targetType: "Space", targetId: space.id, before: snapshot(current), after: snapshot(space), actorUserId: actorId(input.actor) });
    return space;
  });
}

/** Archive (hide and stop new bookings) or restore a space. Existing bookings stay. */
export async function setSpaceArchived(input: { makerspaceId: string; spaceId: string; actor: Actor; archived: boolean; now?: Date }, db: DbOrTx = defaultDb()): Promise<Space> {
  requireStaff(input.actor, "spaces.manage");
  return withTx(db, async (tx) => {
    const current = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId } });
    if (!current) throw notFound("Space");
    const space = await tx.space.update({ where: { id: current.id }, data: input.archived ? { archivedAt: input.now ?? new Date(), published: false } : { archivedAt: null } });
    await saveSetting(tx, { area: "space", makerspaceId: input.makerspaceId, targetType: "Space", targetId: space.id, before: snapshot(current), after: snapshot(space), actorUserId: actorId(input.actor) });
    return space;
  });
}

const photoSchema = z.object({ url: z.string().trim().min(1).max(2048), storageKey: z.string().max(512).nullable().optional(), alt: z.string().trim().max(200).default("") });

export async function addSpacePhoto(input: { makerspaceId: string; spaceId: string; actor: Actor; photo: unknown }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "spaces.manage");
  const parsed = photoSchema.safeParse(input.photo);
  if (!parsed.success) throw zodInputError(parsed.error.issues);
  return withTx(db, async (tx) => {
    const space = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId }, select: { id: true } });
    if (!space) throw notFound("Space");
    if ((await tx.spacePhoto.count({ where: { spaceId: space.id } })) >= 20) throw invalidInput("A space can have up to 20 photos.");
    const sortOrder = (await tx.spacePhoto.count({ where: { spaceId: space.id } })) * 10;
    const photo = await tx.spacePhoto.create({ data: { makerspaceId: input.makerspaceId, spaceId: space.id, url: parsed.data.url, storageKey: parsed.data.storageKey ?? null, alt: parsed.data.alt, sortOrder } });
    await saveSetting(tx, { area: "space-photo", makerspaceId: input.makerspaceId, targetType: "SpacePhoto", targetId: photo.id, before: null, after: { url: photo.url, alt: photo.alt, sortOrder }, actorUserId: actorId(input.actor) });
    return photo;
  });
}

export async function removeSpacePhoto(input: { makerspaceId: string; photoId: string; actor: Actor }, db: DbOrTx = defaultDb()) {
  requireStaff(input.actor, "spaces.manage");
  return withTx(db, async (tx) => {
    const photo = await tx.spacePhoto.findFirst({ where: { id: input.photoId, makerspaceId: input.makerspaceId } });
    if (!photo) throw notFound("Photo");
    await tx.spacePhoto.delete({ where: { id: photo.id } });
    await saveSetting(tx, { area: "space-photo", makerspaceId: input.makerspaceId, targetType: "SpacePhoto", targetId: photo.id, before: { url: photo.url, alt: photo.alt, sortOrder: photo.sortOrder }, after: null, actorUserId: actorId(input.actor) });
    return photo;
  });
}
