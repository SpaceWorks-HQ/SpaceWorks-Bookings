"use server";

import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canDeleteMakerspace,
  canManageTeam,
  canManageTeamMember,
  getMembership,
  hasAuthenticator,
  STAFF_AUTHENTICATOR_MESSAGE,
} from "@/lib/permissions";
import {
  deleteMakerspaceSchema,
  removeTeamMemberSchema,
  updateTeamRoleSchema,
} from "@/lib/validators";
import type { ActionResult } from "./makerspace";
import { flattenZodErrors } from "./utils";
import { makerspaceAllows } from "@/lib/permissionRoles";
import { canDeleteInStatus, MAKERSPACE_LOCKED } from "@/lib/makerspaceLifecycle";
import { recordAuditEvent } from "@/lib/audit";
import { hasRecentAuthentication } from "@/lib/reauth";
import { LAST_MANAGER_MESSAGE, lockTeamMember } from "@/lib/teamManagers";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

export async function updateTeamRole(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = updateTeamRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { makerspaceSlug, targetUserId, role } = parsed.data;
  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: makerspaceSlug },
  });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, "team.manage")) return { ok: false, error: MAKERSPACE_LOCKED };

  const actor = await getMembership(session.user.id, makerspace.id);
  if (!actor || !canManageTeam(actor)) {
    return { ok: false, error: "Only bookings managers can change team roles." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (!(await hasRecentAuthentication())) {
    return { ok: false, error: "For security, sign in again before changing team roles." };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const target = await lockTeamMember(tx, makerspace.id, targetUserId);
    if (!target) return "Team member not found.";
    if (!canManageTeamMember(actor.role, target.role) || !canManageTeamMember(actor.role, role)) {
      return "You can't change this person's role.";
    }
    if (target.last && role !== target.role) return LAST_MANAGER_MESSAGE;
    await tx.teamMember.update({ where: { id: target.id }, data: { role } });
    await recordAuditEvent({
      action: "TEAM_ROLE_CHANGED",
      actorUserId: actor.userId,
      makerspaceId: makerspace.id,
      targetType: "teamMember",
      targetId: target.id,
      metadata: { role, from: target.role },
      client: tx,
    });
    return null;
  });
  if (outcome) return { ok: false, error: outcome };

  revalidatePath(`/dashboard/${makerspace.slug}/team`);
  revalidatePath(`/dashboard/${makerspace.slug}`);
  return { ok: true };
}

export async function removeTeamMember(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = removeTeamMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { makerspaceSlug, targetUserId } = parsed.data;
  if (targetUserId === session.user.id) {
    return { ok: false, error: "You cannot remove yourself this way." };
  }

  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: makerspaceSlug },
  });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, "team.manage")) return { ok: false, error: MAKERSPACE_LOCKED };

  const actor = await getMembership(session.user.id, makerspace.id);
  if (!actor || !canManageTeam(actor)) {
    return { ok: false, error: "You do not have permission to remove people from the team." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };

  const outcome = await prisma.$transaction(async (tx) => {
    const target = await lockTeamMember(tx, makerspace.id, targetUserId);
    if (!target) return "Team member not found.";
    if (!canManageTeamMember(actor.role, target.role)) return "You can't remove this person from the team.";
    if (target.last) return LAST_MANAGER_MESSAGE;
    await tx.teamMember.delete({ where: { id: target.id } });
    await recordAuditEvent({
      action: "TEAM_MEMBER_REMOVED",
      actorUserId: actor.userId,
      makerspaceId: makerspace.id,
      targetType: "teamMember",
      targetId: target.id,
      metadata: { role: target.role },
      client: tx,
    });
    return null;
  });
  if (outcome) return { ok: false, error: outcome };

  revalidatePath(`/dashboard/${makerspace.slug}/team`);
  revalidatePath(`/dashboard/${makerspace.slug}`);
  return { ok: true };
}

export async function deleteMakerspace(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = deleteMakerspaceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: parsed.data.makerspaceSlug },
  });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };

  if (!canDeleteInStatus(makerspace.status)) return { ok: false, error: "A suspended or archived makerspace keeps its records and can't be deleted." };

  const membership = await getMembership(session.user.id, makerspace.id);
  if (!canDeleteMakerspace(membership)) {
    return { ok: false, error: "Only a bookings manager can delete the makerspace." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (!(await hasRecentAuthentication())) {
    return { ok: false, error: "For security, sign in again before deleting a makerspace." };
  }

  // Money records are kept for audit (8 years); a makerspace that has taken payments is archived instead.
  if (await prisma.payment.count({ where: { makerspaceId: makerspace.id, status: { in: ["PAID", "WAIVED"] } } }) || await prisma.financeEntry.count({ where: { makerspaceId: makerspace.id } })) {
    return { ok: false, error: "This makerspace has taken payments, so its records must be kept. Ask a platform admin to archive it instead." };
  }

  const slug = makerspace.slug;
  // Deliberately omit makerspaceId: deleting the makerspace cascades its
  // scoped records, while this audit record must survive at the instance level.
  await recordAuditEvent({
    action: "MAKERSPACE_DELETED",
    actorUserId: session.user.id,
    targetType: "makerspace",
    targetId: makerspace.id,
  });
  await prisma.$transaction([
    prisma.paymentLine.deleteMany({ where: { makerspaceId: makerspace.id } }),
    prisma.payment.deleteMany({ where: { makerspaceId: makerspace.id } }),
    prisma.makerspace.delete({ where: { id: makerspace.id } }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath(`/m/${slug}`);
  return { ok: true };
}
