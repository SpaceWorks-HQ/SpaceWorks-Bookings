"use server";

import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canDeleteOrg,
  canManageTeam,
  canManageTeamMember,
  getMembership,
  orgActionAccess,
  hasAuthenticator,
  STAFF_AUTHENTICATOR_MESSAGE,
} from "@/lib/permissions";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  deleteOrganisationSchema,
  removeTeamMemberSchema,
  updateTeamRoleSchema,
} from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { organisationAllows } from "@/lib/permissionRoles";
import { canDeleteInStatus, ORGANISATION_LOCKED } from "@/lib/organisationLifecycle";
import { recordAuditEvent } from "@/lib/audit";
import { hasRecentAuthentication } from "@/lib/reauth";

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

  const { organisationSlug, targetUserId, role } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };
  if (!organisationAllows(org.status, "team.manage")) return { ok: false, error: ORGANISATION_LOCKED };

  const actor = await getMembership(session.user.id, org.id);
  if (!actor || !canManageTeam(actor)) {
    return { ok: false, error: "Only owners and managers can change team roles." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (!(await hasRecentAuthentication())) {
    return { ok: false, error: "For security, sign in again before changing team roles." };
  }

  const target = await getMembership(targetUserId, org.id);
  if (!target) return { ok: false, error: "Team member not found." };
  if (target.role === "OWNER") {
    return { ok: false, error: "The owner role cannot be changed here." };
  }
  // Admins manage treasurers and viewers only, and cannot promote anyone to admin.
  if (!canManageTeamMember(actor.role, target.role) || !canManageTeamMember(actor.role, role)) {
    return { ok: false, error: "Admins can only change treasurer and viewer roles." };
  }

  await prisma.teamMember.update({
    where: { id: target.id },
    data: { role },
  });
  await recordAuditEvent({
    action: "TEAM_ROLE_CHANGED",
    actorUserId: session.user.id,
    organisationId: org.id,
    targetType: "teamMember",
    targetId: target.id,
    metadata: { role },
  });

  revalidatePath(`/dashboard/${org.slug}/team`);
  revalidatePath(`/dashboard/${org.slug}`);
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

  const { organisationSlug, targetUserId } = parsed.data;
  if (targetUserId === session.user.id) {
    return { ok: false, error: "You cannot remove yourself this way." };
  }

  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };
  if (!organisationAllows(org.status, "team.manage")) return { ok: false, error: ORGANISATION_LOCKED };

  const actor = await getMembership(session.user.id, org.id);
  if (!actor || !canManageTeam(actor)) {
    return { ok: false, error: "You do not have permission to remove people from the team." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };

  const target = await getMembership(targetUserId, org.id);
  if (!target) return { ok: false, error: "Team member not found." };
  if (target.role === "OWNER") {
    return { ok: false, error: "Cannot remove the organisation owner." };
  }
  if (!canManageTeamMember(actor.role, target.role)) {
    return { ok: false, error: "Admins can only remove treasurers and viewers." };
  }

  await prisma.teamMember.delete({ where: { id: target.id } });
  await recordAuditEvent({
    action: "TEAM_MEMBER_REMOVED",
    actorUserId: session.user.id,
    organisationId: org.id,
    targetType: "teamMember",
    targetId: target.id,
  });

  revalidatePath(`/dashboard/${org.slug}/team`);
  revalidatePath(`/dashboard/${org.slug}`);
  return { ok: true };
}

export async function deleteOrganisation(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = deleteOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const org = await prisma.organisation.findUnique({
    where: { slug: parsed.data.organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  if (!canDeleteInStatus(org.status)) return { ok: false, error: "A suspended or archived organisation keeps its records and can't be deleted." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canDeleteOrg(membership)) {
    return { ok: false, error: "Only the organisation owner can delete it." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (!(await hasRecentAuthentication())) {
    return { ok: false, error: "For security, sign in again before deleting an organisation." };
  }

  // Money records are kept for audit (8 years); an organisation that has taken payments is archived instead.
  if ((await prisma.payment.count({ where: { organisationId: org.id, status: { in: ["PAID", "WAIVED"] } } })) || (await prisma.ledgerEntry.count({ where: { organisationId: org.id } }))) {
    return { ok: false, error: "This organisation has taken payments, so its records must be kept. Ask a platform admin to archive it instead." };
  }

  const slug = org.slug;
  // Deliberately omit organisationId: deleting the organisation cascades its
  // scoped records, while this audit record must survive at the instance level.
  await recordAuditEvent({
    action: "ORGANISATION_DELETED",
    actorUserId: session.user.id,
    targetType: "organisation",
    targetId: org.id,
  });
  await prisma.$transaction([
    prisma.paymentLine.deleteMany({ where: { organisationId: org.id } }),
    prisma.payment.deleteMany({ where: { organisationId: org.id } }),
    prisma.organisation.delete({ where: { id: org.id } }),
  ]);

  revalidatePath("/dashboard");
  revalidatePath(`/o/${slug}`);
  return { ok: true };
}

const unitScopeSchema = z.object({
  organisationSlug: z.string().trim().min(1),
  targetUserId: z.string().trim().min(1).max(64),
  unitId: z.string().trim().max(64).optional().nullable().transform((value) => value || null),
});

/**
 * Limit a team member to one unit's subtree (a region or chapter manager), or give them the whole
 * organisation again. Owners are never limited, and only people with org-wide reach can set scopes.
 */
export async function setTeamMemberUnit(input: unknown): Promise<ActionResult> {
  const parsed = unitScopeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const access = await orgActionAccess(parsed.data.organisationSlug, "team.manage");
  if (!access.ok) return access;
  if (access.membership.unitId) return { ok: false, error: "Only owners and organisation-wide managers can set unit access." };
  if (await isActionRateLimited("action", access.userId)) return { ok: false, error: "Too many requests. Try again shortly." };
  const target = await getMembership(parsed.data.targetUserId, access.organisation.id);
  if (!target) return { ok: false, error: "That person isn't on the team." };
  if (target.role === "OWNER") return { ok: false, error: "Owners always see the whole organisation." };
  if (!canManageTeamMember(access.membership.role, target.role)) return { ok: false, error: "You can't change this person's access." };
  if (parsed.data.unitId && !(await prisma.orgUnit.count({ where: { id: parsed.data.unitId, organisationId: access.organisation.id, archivedAt: null } }))) {
    return { ok: false, error: "That unit no longer exists." };
  }
  await prisma.teamMember.update({ where: { id: target.id }, data: { unitId: parsed.data.unitId } });
  await recordAuditEvent({ action: "TEAM_UNIT_SCOPE_CHANGED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "teamMember", targetId: target.id, metadata: { scoped: Boolean(parsed.data.unitId) } });
  revalidatePath(`/dashboard/${access.organisation.slug}/team`);
  return { ok: true };
}
