"use server";

import crypto from "crypto";
import { Prisma, type MakerspaceStatus } from "@prisma/client";
import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { requireSuperAdmin } from "@/lib/permissions";
import { isReviewDecision, REVIEW_DECISIONS } from "@/lib/makerspaceLifecycle";
import { applicationSnapshot, notifyOwners, makerspaceApplicationSchema, releaseHeldSlug } from "@/lib/makerspaces";
import { enqueueOutbox } from "@/lib/outbox";
import type { ActionResult } from "./makerspace";
import { flattenZodErrors } from "./utils";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

/** Owner invites from a platform admin last two weeks: long enough for someone to notice the email. */
const OWNER_INVITE_DAYS = 14;

const reviewSchema = z.object({
  makerspaceId: z.string().trim().min(1).max(64),
  decision: z.string().refine(isReviewDecision, "Unknown decision"),
  reason: z.string().trim().max(2000).optional().transform((value) => value || null),
});

const limitSchema = z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(1_000_000)]).transform((value) => (value === "" ? null : value));
const limitsSchema = z.object({
  makerspaceId: z.string().trim().min(1).max(64),
  managerLimit: limitSchema,
});

const createSchema = makerspaceApplicationSchema.extend({
  ownerEmail: z.string().trim().toLowerCase().email("Enter the owner's email address").max(320),
});


async function superAdmin() {
  const session = await requireSuperAdmin();
  if (await isActionRateLimited("action", session.user.id)) return null;
  return session;
}

const TOO_MANY = { ok: false as const, error: "Too many requests. Try again shortly." };

/** Approve, ask for changes, decline, suspend, reactivate or archive a makerspace. */
export async function reviewMakerspace(input: unknown): Promise<ActionResult> {
  const session = await superAdmin();
  if (!session) return TOO_MANY;
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid decision.", fieldErrors: flattenZodErrors(parsed.error) };
  const { makerspaceId, reason } = parsed.data;
  const decision = REVIEW_DECISIONS[parsed.data.decision as keyof typeof REVIEW_DECISIONS];
  if (decision.reasonRequired && !reason) return { ok: false, error: "Add a note for the makerspace.", fieldErrors: { reason: ["The makerspace is told this note"] } };

  const outcome = await prisma.$transaction(async (tx) => {
    // Lock the row: two admins deciding at once, or a resubmission mid-decision, must not interleave.
    const [current] = await tx.$queryRaw<Array<{ status: MakerspaceStatus; slug: string }>>`SELECT "status", "slug" FROM "Makerspace" WHERE "id" = ${makerspaceId} FOR UPDATE`;
    if (!current) return { kind: "missing" as const };
    if (!decision.from.includes(current.status)) return { kind: "stale" as const };
    await tx.makerspace.update({ where: { id: makerspaceId }, data: { status: decision.to } });
    await tx.makerspaceReview.create({ data: { makerspaceId, action: decision.action, actorUserId: session.user.id, reason } });
    if (decision.notice) await notifyOwners(tx, makerspaceId, decision.notice, reason);
    await recordAuditEvent({
      action: `MAKERSPACE_${decision.action}`,
      actorUserId: session.user.id,
      makerspaceId,
      targetType: "Makerspace",
      targetId: makerspaceId,
      metadata: { from: current.status, to: decision.to },
      client: tx,
    });
    return { kind: "done" as const, slug: current.slug };
  });
  if (outcome.kind === "missing") return { ok: false, error: "Makerspace not found." };
  if (outcome.kind === "stale") return { ok: false, error: "Its status changed while you were looking. Reload and decide again." };
  revalidatePath("/super-admin/makerspaces");
  revalidatePath(`/super-admin/makerspaces/${makerspaceId}`);
  revalidatePath(`/dashboard/${outcome.slug}`, "layout");
  return { ok: true };
}

/** Cap how many people a makerspace may have on its team. Empty means no cap. */
export async function setMakerspaceLimits(input: unknown): Promise<ActionResult> {
  const session = await superAdmin();
  if (!session) return TOO_MANY;
  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The limit must be a whole number of at least 1, or empty.", fieldErrors: flattenZodErrors(parsed.error) };
  const { makerspaceId, managerLimit } = parsed.data;
  const updated = await prisma.makerspace.updateMany({ where: { id: makerspaceId }, data: { managerLimit } });
  if (updated.count !== 1) return { ok: false, error: "Makerspace not found." };
  await recordAuditEvent({
    action: "MAKERSPACE_LIMITS_CHANGED",
    actorUserId: session.user.id,
    makerspaceId,
    targetType: "Makerspace",
    targetId: makerspaceId,
    metadata: { managerLimit },
  });
  revalidatePath(`/super-admin/makerspaces/${makerspaceId}`);
  return { ok: true };
}

/**
 * Set up an approved makerspace for someone. They become its owner by accepting an invite bound to
 * their email address, so a makerspace never has an owner who did not agree to it.
 */
export async function createMakerspaceForOwner(input: unknown): Promise<ActionResult<{ makerspaceId: string }>> {
  const session = await superAdmin();
  if (!session) return TOO_MANY;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const { ownerEmail, ...application } = parsed.data;

  try {
    const makerspaceId = await prisma.$transaction(async (tx) => {
      await releaseHeldSlug(tx, application.slug);
      const { slug, ...profile } = application;
      const created = await tx.makerspace.create({
        data: { ...profile, slug, status: "ACTIVE", source: "SUPERADMIN" },
        select: { id: true },
      });
      await tx.makerspaceReview.create({
        data: { makerspaceId: created.id, action: "CREATED", actorUserId: session.user.id, applicationSnapshot: applicationSnapshot(application) },
      });
      const expiresAt = new Date(Date.now() + OWNER_INVITE_DAYS * 24 * 60 * 60_000);
      const invite = await tx.teamInvite.create({
        data: { makerspaceId: created.id, token: crypto.randomBytes(24).toString("base64url"), role: "OWNER", email: ownerEmail, createdByUserId: session.user.id, expiresAt },
        select: { id: true, token: true },
      });
      await enqueueOutbox(tx, "owner-invite", { to: ownerEmail, makerspaceId: created.id, token: invite.token, expiresAt: expiresAt.toISOString() });
      await recordAuditEvent({ action: "MAKERSPACE_CREATED", actorUserId: session.user.id, makerspaceId: created.id, targetType: "Makerspace", targetId: created.id, client: tx });
      await recordAuditEvent({ action: "MAKERSPACE_INVITE_CREATED", actorUserId: session.user.id, makerspaceId: created.id, targetType: "TeamInvite", targetId: invite.id, metadata: { role: "OWNER" }, client: tx });
      return created.id;
    });
    revalidatePath("/super-admin/makerspaces");
    return { ok: true, data: { makerspaceId } };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "That web address is taken.", fieldErrors: { slug: ["That web address is taken"] } };
    }
    throw error;
  }
}

/** Send a fresh owner invite when the first expired or went to the wrong inbox. */
export async function resendOwnerInvite(input: unknown): Promise<ActionResult> {
  const session = await superAdmin();
  if (!session) return TOO_MANY;
  const parsed = z.object({ makerspaceId: z.string().trim().min(1).max(64), ownerEmail: z.string().trim().toLowerCase().email("Enter the owner's email address").max(320) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  const { makerspaceId, ownerEmail } = parsed.data;
  const makerspace = await prisma.makerspace.findUnique({ where: { id: makerspaceId }, select: { id: true, _count: { select: { teamMembers: { where: { role: "OWNER" } } } } } });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (makerspace._count.teamMembers > 0) return { ok: false, error: "This makerspace already has an owner. They can invite others from the Team page." };

  const expiresAt = new Date(Date.now() + OWNER_INVITE_DAYS * 24 * 60 * 60_000);
  await prisma.$transaction(async (tx) => {
    // Only one owner invite stays usable.
    await tx.teamInvite.deleteMany({ where: { makerspaceId, role: "OWNER", usedAt: null } });
    const invite = await tx.teamInvite.create({
      data: { makerspaceId, token: crypto.randomBytes(24).toString("base64url"), role: "OWNER", email: ownerEmail, createdByUserId: session.user.id, expiresAt },
      select: { id: true, token: true },
    });
    await enqueueOutbox(tx, "owner-invite", { to: ownerEmail, makerspaceId, token: invite.token, expiresAt: expiresAt.toISOString() });
    await recordAuditEvent({ action: "MAKERSPACE_INVITE_CREATED", actorUserId: session.user.id, makerspaceId, targetType: "TeamInvite", targetId: invite.id, metadata: { role: "OWNER" }, client: tx });
  });
  revalidatePath(`/super-admin/makerspaces/${makerspaceId}`);
  return { ok: true };
}

const visibilitySchema = z.object({ makerspaceId: z.string().trim().min(1).max(64), visibility: z.enum(["UNLISTED", "PUBLIC"]) });

/** List a makerspace in the public directory (anyone can find it and apply) or take it off. */
export async function setMakerspaceVisibility(input: unknown): Promise<ActionResult> {
  const session = await superAdmin();
  if (!session) return TOO_MANY;
  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const makerspace = await prisma.makerspace.findUnique({ where: { id: parsed.data.makerspaceId }, select: { status: true, slug: true } });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (parsed.data.visibility === "PUBLIC" && makerspace.status !== "ACTIVE") return { ok: false, error: "Only an active makerspace can be listed publicly." };
  await prisma.makerspace.update({ where: { id: parsed.data.makerspaceId }, data: { visibility: parsed.data.visibility } });
  await recordAuditEvent({ action: "MAKERSPACE_VISIBILITY_CHANGED", actorUserId: session.user.id, makerspaceId: parsed.data.makerspaceId, targetType: "Makerspace", targetId: parsed.data.makerspaceId, metadata: { visibility: parsed.data.visibility } });
  revalidatePath(`/super-admin/makerspaces/${parsed.data.makerspaceId}`);
  revalidatePath("/makerspaces");
  revalidatePath(`/m/${makerspace.slug}`);
  return { ok: true };
}
