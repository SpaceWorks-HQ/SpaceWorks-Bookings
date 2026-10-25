"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, getMembership, hasAuthenticator, makerspaceAllows, STAFF_AUTHENTICATOR_MESSAGE } from "@/lib/permissions";
import { MAKERSPACE_LOCKED } from "@/lib/makerspaceLifecycle";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "./makerspace";

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

export async function uploadMakerspaceLogo(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("upload", session.user.id))
    return { ok: false, error: "Too many uploads. Please try again later." };
  const slug = String(formData.get("makerspaceSlug") ?? "").trim();
  const makerspace = slug
    ? await prisma.makerspace.findUnique({
        where: { slug },
        select: { id: true, slug: true, status: true },
      })
    : null;
  if (!makerspace) return { ok: false, error: "Makerspace not found." };
  if (!makerspaceAllows(makerspace.status, "makerspace.settings")) return { ok: false, error: MAKERSPACE_LOCKED };
  const membership = await getMembership(session.user.id, makerspace.id);
  if (!membership || !can(membership.role, "makerspace.settings"))
    return { ok: false, error: "Only bookings managers can upload logos." };
  if (!(await hasAuthenticator(session.user.id))) return { ok: false, error: STAFF_AUTHENTICATOR_MESSAGE };
  const derivative = await imageFile(formData);
  if ("error" in derivative) return { ok: false, error: derivative.error };
  try {
    const key = `makerspaces/${makerspace.id}/makerspace-logos/${crypto.randomUUID()}.webp`;
    await uploadFile({
      key,
      body: derivative.body,
      contentType: "image/webp",
      makerspaceId: makerspace.id,
    });
    await recordAuditEvent({
      action: "MAKERSPACE_LOGO_UPLOADED",
      actorUserId: session.user.id,
      makerspaceId: makerspace.id,
      targetType: "Makerspace",
      targetId: makerspace.id,
    });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    console.error("[media] makerspace logo upload failed");
    return { ok: false, error: "Could not upload the makerspace logo." };
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
