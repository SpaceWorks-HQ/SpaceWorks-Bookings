import type { MakerspaceStatus, TeamMember, TeamRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Session } from "next-auth";



export async function getMembership(
  userId: string,
  makerspaceId: string,
): Promise<TeamMember | null> {
  return prisma.teamMember.findUnique({
    where: {
      userId_makerspaceId: { userId, makerspaceId },
    },
  });
}

/** Read from the database for mutation gates; session JWTs can be stale. */
export async function isUserEmailVerified(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  return user?.emailVerified != null;
}

export async function requireAuth(): Promise<Session & { user: { id: string; }; }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session as Session & { user: { id: string; }; };
}

/**
 * Instance-wide super-admin gate: a verified user flagged `isSuperAdmin`. Super admins are created and their
 * passwords set only on the server (`docker/ops/admin.mjs`). Anyone else gets notFound(), so the panel's
 * existence is never revealed.
 */
export async function requireSuperAdmin(): Promise<
  Session & { user: { id: string; email: string; }; }
> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerified: true, isSuperAdmin: true },
  });
  const userEmail = user?.email;
  if (!userEmail || !user.emailVerified) notFound();
  if (!user.isSuperAdmin) notFound();

  return {
    ...session,
    user: { ...session.user, id: session.user.id, email: userEmail },
  } as Session & { user: { id: string; email: string; }; };
}

export type MakerspaceAccessContext = {
  makerspace: { id: string; slug: string; name: string; status: MakerspaceStatus; };
  membership: TeamMember;
  userId: string;
};

/**
 * Team access to a makerspace, whatever its status. Use only for the application page and other
 * screens that must work before approval; everything else goes through requireMakerspaceRole/Capability.
 */
export async function requireMakerspaceTeam(makerspaceSlug: string): Promise<MakerspaceAccessContext> {
  const session = await requireAuth();
  const makerspace = await prisma.makerspace.findUnique({ where: { slug: makerspaceSlug }, select: { id: true, slug: true, name: true, status: true } });
  if (!makerspace) redirect("/dashboard");
  const membership = await getMembership(session.user.id, makerspace.id);
  if (!membership) redirect("/dashboard");
  if (!(await hasAuthenticator(session.user.id))) redirect(STAFF_AUTHENTICATOR_SETUP);
  return { makerspace: makerspace, membership, userId: session.user.id };
}

/** Staff (anyone on a makerspace's team) must use an authenticator app; members and super admins need not. */
export async function hasAuthenticator(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabledAt: true } });
  return Boolean(user?.mfaEnabledAt);
}

/** Team access with a minimum role. Makerspaces that are not active are sent to their application page. */
export async function requireMakerspaceRole(
  makerspaceSlug: string,
  minRole: TeamRole,
): Promise<MakerspaceAccessContext> {
  const access = await requireMakerspaceTeam(makerspaceSlug);
  if (access.makerspace.status !== "ACTIVE") redirect(`/dashboard/${makerspaceSlug}/application`);
  if (!hasRoleAtLeast(access.membership.role, minRole)) redirect(`/dashboard/${makerspaceSlug}`);
  return access;
}

export async function requireMakerspaceMembership(
  makerspaceSlug: string,
): Promise<MakerspaceAccessContext> {
  return requireMakerspaceRole(makerspaceSlug, "VIEWER");
}

/** Any team member may open the makerspace dashboard; what they see is gated by capability. */
export async function requireMakerspaceDashboardAccess(makerspaceSlug: string): Promise<MakerspaceAccessContext> {
  return requireMakerspaceMembership(makerspaceSlug);
}

/** Team access for one capability, honouring the makerspace's status (suspended keeps finance). */
export async function requireMakerspaceCapability(makerspaceSlug: string, capability: Capability): Promise<MakerspaceAccessContext> {
  const access = await requireMakerspaceTeam(makerspaceSlug);
  if (!makerspaceAllows(access.makerspace.status, capability)) redirect(`/dashboard/${makerspaceSlug}/application`);
  if (!can(access.membership.role, capability)) redirect(`/dashboard/${makerspaceSlug}`);
  return access;
}

export type MakerspaceActionAccess =
  | { ok: true; makerspace: MakerspaceAccessContext["makerspace"]; membership: TeamMember; userId: string }
  | { ok: false; error: string };

/**
 * The server-action counterpart of requireMakerspaceCapability: returns an error instead of redirecting, so
 * every action applies the same tenant, status and role checks before touching data.
 */
export async function makerspaceActionAccess(makerspaceSlug: unknown, capability: Capability): Promise<MakerspaceActionAccess> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (typeof makerspaceSlug !== "string" || !makerspaceSlug) return { ok: false, error: "Makerspace not found." };
  const makerspace = await prisma.makerspace.findUnique({ where: { slug: makerspaceSlug }, select: { id: true, slug: true, name: true, status: true } });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  const membership = await getMembership(session.user.id, makerspace.id);
  if (!membership) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, capability)) {
    return { ok: false, error: makerspace.status === "SUSPENDED" ? "This makerspace is suspended, so this can't be changed right now." : "This makerspace isn't approved yet." };
  }
  if (!can(membership.role, capability)) return { ok: false, error: "Your role doesn't allow this." };
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  return { ok: true, makerspace: makerspace, membership, userId: session.user.id };
}

export { can, hasRoleAtLeast, isMakerspaceAdmin, canManageTeam, canManageTeamMember, canDeleteMakerspace, makerspaceAllows, STAFF_AUTHENTICATOR_MESSAGE, STAFF_AUTHENTICATOR_SETUP } from "@/lib/permissionRoles";

import { can, hasRoleAtLeast, makerspaceAllows, STAFF_AUTHENTICATOR_MESSAGE, STAFF_AUTHENTICATOR_SETUP, type Capability } from "./permissionRoles";
