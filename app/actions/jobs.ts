"use server";

import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { requireSuperAdmin } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { QUEUE_NAMES } from "@/lib/queue/definitions";
import { manageQueue } from "@/lib/queue/admin";
import type { ActionResult } from "./makerspace";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
const schema = z.object({ queue: z.enum(QUEUE_NAMES), operation: z.enum(["pause", "resume", "retry", "remove"]), jobId: z.string().min(1).max(256).optional() });

/** A super admin pauses or resumes a queue, or retries or removes one failed job. Every change is audited. */
export async function manageJobsAction(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdmin();
  if (await isActionRateLimited("action", session.user.id)) return { ok: false, error: "Too many requests. Try again shortly." };
  const parsed = schema.safeParse(input);
  if (!parsed.success || (["retry", "remove"].includes(parsed.data.operation) && !parsed.data.jobId)) return { ok: false, error: "Choose a queue and a failed job." };
  try {
    await manageQueue(parsed.data);
  } catch {
    return { ok: false, error: "The queue could not be updated. Refresh and try again." };
  }
  await recordAuditEvent({ action: `JOBS_${parsed.data.operation.toUpperCase()}`, actorUserId: session.user.id, targetType: "Queue", targetId: parsed.data.queue, metadata: { jobId: parsed.data.jobId ?? null } });
  revalidatePath("/super-admin/jobs");
  return { ok: true };
}
