"use server";

import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { orgActionAccess } from "@/lib/permissions";
import { teamScope, unitInScope } from "@/lib/membership/scope";
import { deleteFiles, getPublicUrl, uploadFile } from "@/lib/storage";
import { uploadKeyFromUrl } from "@/lib/uploadUrl";
import type { ActionResult } from "./org";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * A manager sets or removes the photo printed on a member's card. The image is re-encoded as a square
 * WebP; the previous upload is deleted once the new one is saved. Without one, cards use the member's
 * own account picture.
 */
export async function setMemberPhoto(formData: FormData): Promise<ActionResult<{ url: string | null }>> {
  const slug = String(formData.get("organisationSlug") ?? "").trim();
  const memberId = String(formData.get("memberId") ?? "").trim().slice(0, 64);
  const remove = formData.get("remove") === "1";
  const access = await orgActionAccess(slug, "members.manage");
  if (!access.ok) return access;
  if (await isActionRateLimited("upload", access.userId)) return { ok: false, error: "Too many uploads. Try again later." };
  const scope = await teamScope(access.organisation.id, access.membership.unitId);
  const member = await prisma.member.findFirst({ where: { id: memberId, organisationId: access.organisation.id, anonymisedAt: null }, select: { id: true, photoUrl: true, unit: { select: { path: true } } } });
  if (!member || !unitInScope(scope, member.unit?.path ?? null)) return { ok: false, error: "Member not found." };

  let url: string | null = null;
  if (!remove) {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo to upload." };
    if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Photos must be 5 MB or smaller." };
    const derivative = await createSafeWebpDerivative(file, { width: 600, height: 600, fit: "cover" });
    if ("error" in derivative) return { ok: false, error: String(derivative.error) };
    const key = `organisations/${access.organisation.id}/member-id-photos/${crypto.randomUUID()}.webp`;
    try {
      await uploadFile({ key, body: derivative.body, contentType: "image/webp", organisationId: access.organisation.id });
    } catch {
      console.error("[media] member photo upload failed");
      return { ok: false, error: "Couldn't upload the photo. Try again." };
    }
    url = getPublicUrl(key);
  }
  await prisma.member.update({ where: { id: member.id }, data: { photoUrl: url } });
  const oldKey = member.photoUrl ? uploadKeyFromUrl(member.photoUrl) : null;
  if (oldKey) await deleteFiles([oldKey]).catch(() => console.error("[media] old member photo not deleted"));
  await recordAuditEvent({ action: remove ? "MEMBER_PHOTO_REMOVED" : "MEMBER_PHOTO_UPLOADED", actorUserId: access.userId, organisationId: access.organisation.id, targetType: "Member", targetId: member.id });
  revalidatePath(`/dashboard/${access.organisation.slug}/members/${member.id}`);
  return { ok: true, data: { url } };
}
