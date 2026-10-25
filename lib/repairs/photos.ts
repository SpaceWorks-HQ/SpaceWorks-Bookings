import "server-only";

import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { deleteFiles, getPublicUrl, uploadFile } from "@/lib/storage";
import { invalidInput } from "@/lib/bookings/errors";
import { addIssuePhoto } from "./issues";
import type { RepairActor } from "./events";

/**
 * Issue photos: re-encoded to a WebP derivative (never the uploaded bytes) under an unguessable key, then attached.
 * The keys are random UUIDs and are never listed outside the issue, its technician's link and the dashboard.
 */
export async function attachIssuePhoto(input: { makerspaceId: string; issueId: string; actor: RepairActor; file: unknown }) {
  if (!(input.file instanceof File) || input.file.size === 0) throw invalidInput("Choose a photo.", { file: "Choose a photo" });
  if (input.file.size > 10 * 1024 * 1024) throw invalidInput("Photos can be at most 10 MB.", { file: "At most 10 MB" });
  const derivative = await createSafeWebpDerivative(input.file, { width: 1600, height: 1600, fit: "inside" });
  if ("error" in derivative) throw invalidInput(derivative.error, { file: derivative.error });
  const key = `makerspaces/${input.makerspaceId}/issue-photos/${crypto.randomUUID()}.webp`;
  await uploadFile({ key, body: derivative.body, contentType: "image/webp", makerspaceId: input.makerspaceId });
  try {
    return await addIssuePhoto({ makerspaceId: input.makerspaceId, issueId: input.issueId, actor: input.actor, url: getPublicUrl(key), storageKey: key });
  } catch (error) {
    await deleteFiles([key]).catch(() => undefined);
    throw error;
  }
}
