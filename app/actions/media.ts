"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, getMembership, hasAuthenticator, organisationAllows, STAFF_AUTHENTICATOR_MESSAGE } from "@/lib/permissions";
import { ORGANISATION_LOCKED } from "@/lib/organisationLifecycle";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "./org";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function imageFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File))
    return { error: "Choose an image to upload." } as const;
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES)
    return { error: "Images must be 5 MB or smaller." } as const;
  const derivative = await createSafeWebpDerivative(file, {
    width: 1200,
    height: 1200,
    fit: "inside",
  });
  return derivative;
}

export async function uploadOrganisationLogo(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("upload", session.user.id))
    return { ok: false, error: "Too many uploads. Please try again later." };
  const slug = String(formData.get("organisationSlug") ?? "").trim();
  const org = slug
    ? await prisma.organisation.findUnique({
        where: { slug },
        select: { id: true, slug: true, status: true },
      })
    : null;
  if (!org) return { ok: false, error: "Organisation not found." };
  if (!organisationAllows(org.status, "org.settings")) return { ok: false, error: ORGANISATION_LOCKED };
  const membership = await getMembership(session.user.id, org.id);
  if (!membership || !can(membership.role, "org.settings"))
    return { ok: false, error: "Only organisation owners and managers can upload logos." };
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  const derivative = await imageFile(formData);
  if ("error" in derivative) return { ok: false, error: derivative.error };
  try {
    const key = `organisations/${org.id}/organisation-logos/${crypto.randomUUID()}.webp`;
    await uploadFile({
      key,
      body: derivative.body,
      contentType: "image/webp",
      organisationId: org.id,
    });
    await recordAuditEvent({
      action: "ORGANISATION_LOGO_UPLOADED",
      actorUserId: session.user.id,
      organisationId: org.id,
      targetType: "Organisation",
      targetId: org.id,
    });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    console.error("[media] organisation logo upload failed");
    return { ok: false, error: "Could not upload the organisation logo." };
  }
}

export async function uploadAccountProfileImage(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("upload", session.user.id))
    return { ok: false, error: "Too many uploads. Please try again later." };
  const derivative = await imageFile(formData);
  if ("error" in derivative) return { ok: false, error: derivative.error };
  try {
    const key = `users/${session.user.id}/profile-images/${crypto.randomUUID()}.webp`;
    await uploadFile({
      key,
      body: derivative.body,
      contentType: "image/webp",
      userId: session.user.id,
    });
    await recordAuditEvent({
      action: "ACCOUNT_PROFILE_IMAGE_UPLOADED",
      actorUserId: session.user.id,
      targetType: "User",
      targetId: session.user.id,
    });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    console.error("[media] account profile image upload failed");
    return { ok: false, error: "Could not upload the profile image." };
  }
}
