"use server";

import { prisma } from "@/lib/db";
import * as spaces from "@/lib/spaces/service";
import * as catalog from "@/lib/spaces/catalog";
import { saveSetting } from "@/lib/settingsAudit";
import { requireStaff } from "@/lib/bookings/actor";
import type { StaffContext } from "@/lib/actions/bookingContext";
import { staffAction } from "@/lib/actions/bookingContext";
import * as inputs from "@/lib/actions/settingsInputs";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { deleteFiles, getPublicUrl, uploadFile } from "@/lib/storage";
import { forbidden, invalidInput, notFound } from "@/lib/bookings/errors";

export async function createSpace(input: unknown) {
  return staffAction(inputs.createSpaceSchema, input, ({ fields }) =>
    "taxRateBps" in fields || "sacCode" in fields ? ["spaces.manage", "payments.settings"] : ["spaces.manage"],
  (data, ctx) => spaces.createSpace({ ...ctx, fields: data.fields }));
}

export async function updateSpace(input: unknown) {
  return staffAction(inputs.updateSpaceSchema, input, ({ fields }) =>
    "taxRateBps" in fields || "sacCode" in fields ? ["spaces.manage", "payments.settings"] : ["spaces.manage"],
  (data, ctx) => spaces.updateSpace({ ...ctx, spaceId: data.spaceId, fields: data.fields }));
}

export async function setSpaceArchived(input: unknown) {
  return staffAction(inputs.archiveSpaceSchema, input, "spaces.manage",
    (data, ctx) => spaces.setSpaceArchived({ ...ctx, spaceId: data.spaceId, archived: data.archived }));
}

/** Upload and attach a validated derivative; callers cannot supply arbitrary URLs or storage keys. */
export async function addSpacePhoto(formData: FormData) {
  return staffAction(inputs.photoUploadSchema, {
    makerspaceSlug: formData.get("makerspaceSlug"), spaceId: formData.get("spaceId"),
    alt: formData.get("alt") ?? "", file: formData.get("file"),
  }, "spaces.manage", async (data, ctx) => {
    const space = await prisma.space.findFirst({ where: { id: data.spaceId, makerspaceId: ctx.makerspaceId }, select: { id: true } });
    if (!space) throw notFound("Space");
    if (await isActionRateLimited("upload", ctx.actor.userId)) throw forbidden("Too many uploads. Please try again later.");
    const derivative = await createSafeWebpDerivative(data.file, { width: 1600, height: 1600, fit: "inside" });
    if ("error" in derivative) throw invalidInput(derivative.error);
    const key = `makerspaces/${ctx.makerspaceId}/space-photos/${crypto.randomUUID()}.webp`;
    await uploadFile({ key, body: derivative.body, contentType: "image/webp", makerspaceId: ctx.makerspaceId });
    try {
      return await spaces.addSpacePhoto({ ...ctx, spaceId: data.spaceId, photo: { url: getPublicUrl(key), storageKey: key, alt: data.alt } });
    } catch (error) {
      await deleteFiles([key]).catch(() => undefined);
      throw error;
    }
  });
}

export async function removeSpacePhoto(input: unknown) {
  return staffAction(inputs.removePhotoSchema, input, "spaces.manage", async (data, ctx) => {
    const photo = await spaces.removeSpacePhoto({ ...ctx, photoId: data.photoId });
    if (photo.storageKey?.startsWith(`makerspaces/${ctx.makerspaceId}/space-photos/`)) await deleteFiles([photo.storageKey]).catch(() => undefined);
    return { photoId: photo.id };
  });
}

export async function reorderSpacePhotos(input: unknown) {
  return staffAction(inputs.reorderPhotosSchema, input, "spaces.manage",
    (data, ctx) => reorderPhotos({ ...ctx, spaceId: data.spaceId, photoIds: data.photoIds }));
}

export async function saveAddOn(input: unknown) {
  return staffAction(inputs.saveAddOnSchema, input, "spaces.manage",
    async (data, ctx) => {
      if (data.addOnId) {
        const current = await prisma.addOn.findFirst({ where: { id: data.addOnId, makerspaceId: ctx.makerspaceId }, select: { sacCode: true } });
        if (!current) throw notFound("Add-on");
        if (current.sacCode !== data.addOn.sacCode) requireStaff(ctx.actor, "payments.settings");
      } else if (data.addOn.sacCode) requireStaff(ctx.actor, "payments.settings");
      return catalog.saveAddOn({ ...ctx, spaceId: data.spaceId, addOnId: data.addOnId, addOn: data.addOn });
    });
}

export async function removeAddOn(input: unknown) {
  return staffAction(inputs.removeAddOnSchema, input, "spaces.manage", (data, ctx) => removeAddOnEntry({ ...ctx, addOnId: data.addOnId }));
}

export async function savePeakRule(input: unknown) {
  return staffAction(inputs.savePeakSchema, input, "spaces.manage",
    (data, ctx) => catalog.savePeakRule({ ...ctx, spaceId: data.spaceId, ruleId: data.ruleId, rule: data.rule }));
}

export async function removePeakRule(input: unknown) {
  return staffAction(inputs.removePeakSchema, input, "spaces.manage", (data, ctx) => catalog.removePeakRule({ ...ctx, ruleId: data.ruleId }));
}

export async function replaceRefundTiers(input: unknown) {
  return staffAction(inputs.refundTiersSchema, input, "payments.settings",
    (data, ctx) => catalog.replaceRefundTiers({ ...ctx, spaceId: data.spaceId, tiers: data.tiers }));
}

/** Only a complete permutation of this space's photos is accepted. */
async function reorderPhotos(input: StaffContext & { spaceId: string; photoIds: string[] }) {
  requireStaff(input.actor, "spaces.manage");
  return prisma.$transaction(async (tx) => {
    const space = await tx.space.findFirst({ where: { id: input.spaceId, makerspaceId: input.makerspaceId }, select: { id: true } });
    if (!space) throw notFound("Space");
    const photos = await tx.spacePhoto.findMany({ where: { spaceId: space.id, makerspaceId: input.makerspaceId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    if (input.photoIds.length !== photos.length || new Set(input.photoIds).size !== photos.length || input.photoIds.some((id) => !photos.some((photo) => photo.id === id))) throw invalidInput("Choose every photo of this space once.");
    for (const [index, id] of input.photoIds.entries()) await tx.spacePhoto.update({ where: { id }, data: { sortOrder: index * 10 } });
    await saveSetting(tx, { area: "space-photos", makerspaceId: input.makerspaceId, targetType: "Space", targetId: space.id,
      before: { photos: photos.map(({ id, sortOrder }) => ({ id, sortOrder })) }, after: { photos: input.photoIds.map((id, index) => ({ id, sortOrder: index * 10 })) }, actorUserId: input.actor.userId });
  });
}

/** Retire the add-on; existing bookings keep their frozen lines. */
async function removeAddOnEntry(input: StaffContext & { addOnId: string }) {
  requireStaff(input.actor, "spaces.manage");
  return prisma.$transaction(async (tx) => {
    const before = await tx.addOn.findFirst({ where: { id: input.addOnId, makerspaceId: input.makerspaceId } });
    if (!before) throw notFound("Add-on");
    await tx.addOn.update({ where: { id: before.id }, data: { active: false } });
    await saveSetting(tx, { area: "add-on", makerspaceId: input.makerspaceId, targetType: "AddOn", targetId: before.id,
      before: { active: before.active }, after: { active: false }, actorUserId: input.actor.userId });
  });
}
