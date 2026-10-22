"use server";

import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateMakerspaceSchema } from "@/lib/validators";
import { flattenZodErrors } from "./utils";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { isMakerspaceUploadUrl } from "@/lib/uploadUrl";
import { makerspaceAllows } from "@/lib/permissionRoles";
import { hasAuthenticator, STAFF_AUTHENTICATOR_MESSAGE } from "@/lib/permissions";
import { MAKERSPACE_LOCKED } from "@/lib/makerspaceLifecycle";

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

export async function updateMakerspace(
  input: unknown,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }
  if (await isActionRateLimited("action", session.user.id)) {
    return { ok: false, error: "Too many requests. Try again shortly." };
  }

  const parsed = updateMakerspaceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { makerspaceSlug, name, description, logoUrl } = parsed.data;
  const makerspace = await prisma.makerspace.findUnique({
    where: { slug: makerspaceSlug },
    select: { id: true, slug: true, status: true },
  });
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, "makerspace.settings")) return { ok: false, error: MAKERSPACE_LOCKED };

  const membership = await prisma.teamMember.findUnique({
    where: {
      userId_makerspaceId: {
        userId: session.user.id,
        makerspaceId: makerspace.id,
      },
    },
    select: { role: true },
  });

  if (
    !membership ||
    (membership.role !== "OWNER" && membership.role !== "ADMIN")
  ) {
    return { ok: false, error: "Only makerspace owners and managers can edit settings." };
  }
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  if (
    logoUrl &&
    !isMakerspaceUploadUrl(logoUrl, makerspace.id, "makerspace-logos")
  ) {
    return { ok: false, error: "Choose an uploaded makerspace logo." };
  }

  try {
    await prisma.makerspace.update({
      where: { id: makerspace.id },
      data: {
        name,
        description: description ?? "",
        logoUrl: logoUrl || null,
      },
    });
    await recordAuditEvent({
      action: "MAKERSPACE_UPDATED",
      actorUserId: session.user.id,
      makerspaceId: makerspace.id,
      targetType: "Makerspace",
      targetId: makerspace.id,
    });
    revalidatePath(`/dashboard/${makerspace.slug}`);
    revalidatePath(`/dashboard/${makerspace.slug}/team`);
    revalidatePath(`/${makerspace.slug}`);
    return { ok: true };
  } catch {
    console.error("[makerspace] update failed");
    return { ok: false, error: "Could not update makerspace." };
  }
}
