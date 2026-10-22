"use server";

import crypto from "crypto";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageTeam, canManageTeamMember, getMembership, hasAuthenticator, STAFF_AUTHENTICATOR_MESSAGE } from "@/lib/permissions";
import { createMakerspaceInviteSchema, revokeMakerspaceInviteSchema } from "@/lib/validators";
import type { ActionResult } from "./makerspace";
import { flattenZodErrors } from "./utils";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { makerspaceAllows } from "@/lib/permissionRoles";
import { MAKERSPACE_LOCKED } from "@/lib/makerspaceLifecycle";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

function randomToken(): string {
  // 32 chars of base64url-ish entropy, no padding.
  return crypto.randomBytes(24).toString("base64url");
}

export async function createMakerspaceInvite(input: unknown): Promise<
  ActionResult<{ token: string; inviteId: string; }>
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (await isActionRateLimited("invite", session.user.id)) {
    return { ok: false, error: "Too many invite requests. Please try again later." };
  }

  const parsed = createMakerspaceInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { makerspaceSlug, role } = parsed.data;
  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: makerspaceSlug },
  });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, "team.manage")) return { ok: false, error: MAKERSPACE_LOCKED };

  const membership = await getMembership(session.user.id, makerspace.id);
  if (!membership || !canManageTeam(membership)) {
    return { ok: false, error: "You do not have permission to invite people to the team." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (!canManageTeamMember(membership.role, role)) {
    return { ok: false, error: "Managers can invite treasurers and viewers only." };
  }

  // Single-use link. Default expiry: 7 days.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Retry on token collision (very unlikely, but unique constraint exists).
  for (let attempt = 0;attempt < 3;attempt++) {
    const token = randomToken();
    try {
      const invite = await prisma.teamInvite.create({
        data: {
          makerspaceId: makerspace.id,
          token,
          role,
          createdByUserId: session.user.id,
          expiresAt,
        },
        select: { id: true, token: true },
      });
      await recordAuditEvent({ action: "MAKERSPACE_INVITE_CREATED", actorUserId: session.user.id, makerspaceId: makerspace.id, targetType: "TeamInvite", targetId: invite.id });
      revalidatePath(`/dashboard/${makerspace.slug}/team`);
      return { ok: true, data: { token: invite.token, inviteId: invite.id } };
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string; }).code === "P2002"
      ) {
        continue;
      }
      console.error("[makerspace invite] creation failed");
      return { ok: false, error: "Could not create invite link." };
    }
  }

  return { ok: false, error: "Could not create invite link. Please try again." };
}

export async function revokeMakerspaceInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (await isActionRateLimited("invite", session.user.id)) {
    return { ok: false, error: "Too many invite requests. Please try again later." };
  }

  const parsed = revokeMakerspaceInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { makerspaceSlug, inviteId } = parsed.data;
  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: makerspaceSlug },
  });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, "team.manage")) return { ok: false, error: MAKERSPACE_LOCKED };

  const membership = await getMembership(session.user.id, makerspace.id);
  if (!membership || !canManageTeam(membership)) {
    return { ok: false, error: "You do not have permission." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };

  const invite = await prisma.teamInvite.findFirst({
    where: { id: inviteId, makerspaceId: makerspace.id },
    select: { id: true, usedAt: true },
  });
  if (!invite) return { ok: false, error: "Invite not found." };
  if (invite.usedAt) return { ok: false, error: "Invite is already used." };

  await prisma.teamInvite.delete({ where: { id: invite.id } });
  await recordAuditEvent({ action: "MAKERSPACE_INVITE_REVOKED", actorUserId: session.user.id, makerspaceId: makerspace.id, targetType: "TeamInvite", targetId: invite.id });
  revalidatePath(`/dashboard/${makerspace.slug}/team`);
  return { ok: true };
}
