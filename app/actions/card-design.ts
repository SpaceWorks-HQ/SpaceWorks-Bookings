"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { recordAuditEvent, recordThrottledAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { orgActionAccess } from "@/lib/permissions";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import { CARD_PREFIX_PATTERN, deriveCardPrefix } from "@/lib/cards/core";
import { CARD_DESIGN_MAX_BYTES, defaultCardDesign, normalizeCardDesign } from "@/lib/cards/design/presets";
import type { ActionResult } from "./org";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Card designs are organisation settings: owners and managers with organisation-wide access. */
async function access(slug: unknown) {
  const result = await orgActionAccess(slug, "org.settings");
  if (!result.ok) return result;
  if (result.membership.unitId) return { ok: false as const, error: "Only organisation-wide managers can change card designs." };
  if (await isActionRateLimited("action", result.userId)) return { ok: false as const, error: "Too many requests. Try again shortly." };
  return result;
}

async function planFor(organisationId: string, planId: string | null) {
  if (!planId) return { ok: true as const, plan: null };
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, organisationId }, select: { id: true, name: true } });
  return plan ? { ok: true as const, plan } : { ok: false as const };
}

/**
 * The row a design is stored in, created from the default when missing. Two saves racing to create it
 * (two managers, or a save and an upload) hit the unique index; the loser reads the winner's row.
 */
async function designRow(organisation: { id: string; name: string }, plan: { id: string; name: string } | null, userId: string) {
  const existing = await prisma.cardDesign.findFirst({ where: { organisationId: organisation.id, planId: plan?.id ?? null } });
  if (existing) return existing;
  const fallback = plan ? await prisma.cardDesign.findFirst({ where: { organisationId: organisation.id, planId: null } }) : null;
  return prisma.cardDesign.create({
    data: {
      organisationId: organisation.id,
      planId: plan?.id ?? null,
      design: (fallback?.design ?? defaultCardDesign({ organisationName: organisation.name, planName: plan?.name ?? "" })) as Prisma.InputJsonValue,
      watermarkUrl: fallback?.watermarkUrl ?? null,
      numberPrefix: fallback?.numberPrefix ?? deriveCardPrefix(organisation.name),
      updatedById: userId,
    },
  }).catch(async (error: unknown) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return prisma.cardDesign.findFirstOrThrow({ where: { organisationId: organisation.id, planId: plan?.id ?? null } });
  });
}

const saveSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  planId: z.string().trim().min(1).max(64).nullable(),
  design: z.record(z.string(), z.unknown()),
  numberPrefix: z.string().trim().toUpperCase().optional(),
});

/** Save the organisation default (planId null) or one plan's own design. Autosaved by the designer. */
export async function saveCardDesign(input: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (JSON.stringify(parsed.data.design).length > CARD_DESIGN_MAX_BYTES) return { ok: false, error: "This design is too large to save." };
  if (parsed.data.numberPrefix !== undefined && !CARD_PREFIX_PATTERN.test(parsed.data.numberPrefix)) return { ok: false, error: "Use 2 to 6 capital letters or digits for the card number prefix." };
  const ctx = await access(parsed.data.organisationSlug);
  if (!ctx.ok) return ctx;
  const found = await planFor(ctx.organisation.id, parsed.data.planId);
  if (!found.ok) return { ok: false, error: "That plan no longer exists." };
  const design = normalizeCardDesign(parsed.data.design, { organisationName: ctx.organisation.name, planName: found.plan?.name ?? "" });
  const row = await designRow(ctx.organisation, found.plan, ctx.userId);
  const saved = await prisma.cardDesign.update({
    where: { id: row.id },
    data: {
      design: design as unknown as Prisma.InputJsonValue,
      updatedById: ctx.userId,
      // The prefix belongs to the organisation default; new and reissued cards use it.
      ...(parsed.data.numberPrefix && !found.plan ? { numberPrefix: parsed.data.numberPrefix } : {}),
    },
  });
  await recordThrottledAuditEvent({ action: "CARD_DESIGN_SAVED", actorUserId: ctx.userId, organisationId: ctx.organisation.id, targetType: "CardDesign", targetId: saved.id, windowMs: 30 * 60_000 });
  // No revalidation: the open designer holds the state, and refreshing it would remount it mid-edit.
  return { ok: true, data: { updatedAt: saved.updatedAt.toISOString() } };
}

const planSchema = z.object({ organisationSlug: z.string().trim().min(1), planId: z.string().trim().min(1).max(64) });

/** Drop a plan's own design, so its cards use the organisation default again. */
export async function revertToOrganisationCardDesign(input: unknown): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await access(parsed.data.organisationSlug);
  if (!ctx.ok) return ctx;
  const { count } = await prisma.cardDesign.deleteMany({ where: { organisationId: ctx.organisation.id, planId: parsed.data.planId } });
  if (count) await recordAuditEvent({ action: "CARD_DESIGN_RESET", actorUserId: ctx.userId, organisationId: ctx.organisation.id, targetType: "MembershipPlan", targetId: parsed.data.planId });
  revalidatePath(`/dashboard/${ctx.organisation.slug}/settings/cards`);
  return { ok: true };
}

/** Upload (or, with remove=1, clear) the watermark image of a design. The designer shows it without a refresh. */
export async function uploadCardWatermark(formData: FormData): Promise<ActionResult<{ url: string | null }>> {
  const ctx = await access(String(formData.get("organisationSlug") ?? ""));
  if (!ctx.ok) return ctx;
  if (await isActionRateLimited("upload", ctx.userId)) return { ok: false, error: "Too many uploads. Please try again later." };
  const planId = String(formData.get("planId") ?? "") || null;
  const found = await planFor(ctx.organisation.id, planId);
  if (!found.ok) return { ok: false, error: "That plan no longer exists." };
  const row = await designRow(ctx.organisation, found.plan, ctx.userId);
  if (formData.get("remove") === "1") {
    await prisma.cardDesign.update({ where: { id: row.id }, data: { watermarkUrl: null, updatedById: ctx.userId } });
    return { ok: true, data: { url: null } };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Choose an image of 5 MB or smaller." };
  const derivative = await createSafeWebpDerivative(file, { width: 1200, height: 1200, fit: "inside" });
  if ("error" in derivative) return { ok: false, error: derivative.error };
  try {
    const key = `organisations/${ctx.organisation.id}/member-id-watermarks/${crypto.randomUUID()}.webp`;
    await uploadFile({ key, body: derivative.body, contentType: "image/webp", organisationId: ctx.organisation.id });
    const url = getPublicUrl(key);
    await prisma.cardDesign.update({ where: { id: row.id }, data: { watermarkUrl: url, updatedById: ctx.userId } });
    await recordAuditEvent({ action: "CARD_WATERMARK_UPLOADED", actorUserId: ctx.userId, organisationId: ctx.organisation.id, targetType: "CardDesign", targetId: row.id });
    return { ok: true, data: { url } };
  } catch {
    console.error("[cards] watermark upload failed");
    return { ok: false, error: "The image didn't upload. Try again." };
  }
}
