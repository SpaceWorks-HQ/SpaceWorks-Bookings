"use server";

import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { LAST_MANAGER_MESSAGE, lockTeamMember } from "@/lib/teamManagers";
import type { ActionResult } from "./makerspace";
import { flattenZodErrors } from "./utils";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

const leaveMakerspaceSchema = z.object({
  makerspaceSlug: z.string().trim().min(1).max(100),
});

const NOT_A_MEMBER = "You are not on this makerspace's team.";

/**
 * The signed-in person leaves a makerspace's team. Only their own team row is removed.
 *
 * The last-manager check and the delete run in one transaction holding a row
 * lock on the makerspace, so two bookings managers leaving at the same time
 * cannot both pass the check and leave the makerspace without one.
 */
export async function leaveMakerspace(input: unknown): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = leaveMakerspaceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  if (await isActionRateLimited("action", userId)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: parsed.data.makerspaceSlug },
    select: { id: true, slug: true },
  });
  // Same answer for an unknown slug and a non-member: nothing to leave either way.
  if (!makerspace) return { ok: false, error: NOT_A_MEMBER };

  const outcome = await prisma.$transaction(async (tx) => {
    const membership = await lockTeamMember(tx, makerspace.id, userId);
    if (!membership) return "not-member" as const;
    if (membership.last) return "last-manager" as const;
    // Scoped to the caller's own user id as well as the row id.
    const removed = await tx.teamMember.deleteMany({ where: { id: membership.id, userId, makerspaceId: makerspace.id } });
    if (removed.count !== 1) return "not-member" as const;
    await recordAuditEvent({
      action: "TEAM_MEMBER_LEFT",
      actorUserId: userId,
      makerspaceId: makerspace.id,
      targetType: "teamMember",
      targetId: membership.id,
      metadata: { role: membership.role },
      client: tx,
    });
    return "left" as const;
  });

  if (outcome === "not-member") return { ok: false, error: NOT_A_MEMBER };
  if (outcome === "last-manager") return { ok: false, error: LAST_MANAGER_MESSAGE };

  revalidatePath("/account/makerspaces");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${makerspace.slug}`);
  revalidatePath(`/dashboard/${makerspace.slug}/team`);
  return { ok: true };
}
