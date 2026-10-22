"use server";

import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { orgActionAccess } from "@/lib/permissions";
import { deleteFiles } from "@/lib/storage";
import { teamScope, unitInScope } from "@/lib/membership/scope";
import { MembershipError } from "@/lib/membership/service";
import { decideErasure } from "@/lib/portal/erasure";
import type { ActionResult } from "./org";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

const decisionSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(64),
  requestId: z.string().trim().min(1).max(64),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional().transform((value) => value || null),
});

/**
 * A manager decides a member's erasure request. Approving anonymises the member in this organisation for
 * good (money rows stay); rejecting needs a note, which is emailed to the member.
 */
export async function decideErasureRequest(input: unknown): Promise<ActionResult> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const access = await orgActionAccess(parsed.data.organisationSlug, "erasure.decide");
  if (!access.ok) return access;
  if (await isActionRateLimited("action", access.userId)) return { ok: false, error: "Too many requests. Try again shortly." };
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: access.organisation.id }, select: { id: true, slug: true, timezone: true, financialYearStartMonth: true } });
  const request = await prisma.erasureRequest.findFirst({ where: { id: parsed.data.requestId, organisationId: org.id }, include: { member: { select: { unit: { select: { path: true } } } } } });
  const scope = await teamScope(org.id, access.membership.unitId);
  if (!request || !unitInScope(scope, request.member.unit?.path ?? null)) return { ok: false, error: "Request not found." };
  try {
    const result = await prisma.$transaction((tx) => decideErasure(tx, { org, requestId: request.id, approve: parsed.data.decision === "approve", note: parsed.data.note, actorUserId: access.userId }));
    // Files go after the commit; a storage hiccup must not undo the erasure.
    await deleteFiles(result.uploadKeys).catch(() => console.error("[erasure] photo cleanup failed"));
    revalidatePath(`/dashboard/${org.slug}/members/${result.memberId}`);
    revalidatePath(`/dashboard/${org.slug}/members`);
    return { ok: true };
  } catch (error) {
    if (error instanceof MembershipError) return { ok: false, error: error.message };
    throw error;
  }
}
