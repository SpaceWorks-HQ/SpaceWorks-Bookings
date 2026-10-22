"use server";

import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateOrganisationSchema } from "@/lib/validators";
import { flattenZodErrors } from "./utils";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { isOrganisationUploadUrl } from "@/lib/uploadUrl";
import { organisationAllows } from "@/lib/permissionRoles";
import { hasAuthenticator, STAFF_AUTHENTICATOR_MESSAGE } from "@/lib/permissions";
import { ORGANISATION_LOCKED } from "@/lib/organisationLifecycle";

const revalidatePath = trackedRevalidation(nextRevalidatePath);

export type ActionResult<T = void> =
  | { ok: true; data?: T; }
  | {
    ok: false;
    error: string;
    fieldErrors?: Record<string, string[]>;
    /** The action needs an explicit confirmation to go ahead (for example, overriding a warning). */
    needsForce?: boolean;
  };

export async function updateOrganisation(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (await isActionRateLimited("action", session.user.id)) {
    return { ok: false, error: "Too many requests. Try again shortly." };
  }

  const parsed = updateOrganisationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, name, description, logoUrl } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true, slug: true, status: true },
  });
  if (!org) return { ok: false, error: "Organisation not found." };
  if (!organisationAllows(org.status, "org.settings")) return { ok: false, error: ORGANISATION_LOCKED };

  const membership = await prisma.teamMember.findUnique({
    where: {
      userId_organisationId: {
        userId: session.user.id,
        organisationId: org.id,
      },
    },
    select: { role: true },
  });

  if (
    !membership ||
    (membership.role !== "OWNER" && membership.role !== "ADMIN")
  ) {
    return { ok: false, error: "Only organisation owners and managers can edit settings." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (
    logoUrl &&
    !isOrganisationUploadUrl(logoUrl, org.id, "organisation-logos")
  ) {
    return { ok: false, error: "Choose an uploaded organisation logo." };
  }

  try {
    await prisma.organisation.update({
      where: { id: org.id },
      data: {
        name,
        description: description ?? "",
        logoUrl: logoUrl || null,
      },
    });
    await recordAuditEvent({
      action: "ORGANISATION_UPDATED",
      actorUserId: session.user.id,
      organisationId: org.id,
      targetType: "Organisation",
      targetId: org.id,
    });
    revalidatePath(`/dashboard/${org.slug}`);
    revalidatePath(`/dashboard/${org.slug}/team`);
    revalidatePath(`/${org.slug}`);
    return { ok: true };
  } catch {
    console.error("[organisation] update failed");
    return { ok: false, error: "Could not update organisation." };
  }
}
