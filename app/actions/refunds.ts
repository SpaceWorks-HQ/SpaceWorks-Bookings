"use server";

import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { createRefund } from "@/lib/payments/refunds";
import { sendRefundToGateway } from "@/lib/payments/refundGateway";
import { paymentAccess, paymentFailure, scopedPayment, type PaymentActionContext } from "@/lib/payments/actionContext";
import type { ActionResult } from "./makerspace";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
const id = z.string().trim().min(1).max(64);
const slug = z.string().trim().min(1).max(64);
type Status = "PENDING" | "PROCESSED" | "FAILED";

function refresh(ctx: PaymentActionContext, payment: { id: string }) {
  revalidatePath(`/dashboard/${ctx.makerspace.slug}/payments/${payment.id}`);
  revalidatePath(`/dashboard/${ctx.makerspace.slug}/payments`);
}

const refundSchema = z.object({
  makerspaceSlug: slug,
  paymentId: id,
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(3, "Give a short reason").max(300),
});

/**
 * Refund all or part of a paid payment. Offline refunds are
 * recorded as already handed back. Gateway refunds are sent to the provider after the refund row commits and
 * tracked to PROCESSED by its answer, its webhook or the scheduler; the credit note follows the money.
 */
export async function refundPayment(input: unknown): Promise<ActionResult<{ status: Status }>> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const ctx = await paymentAccess(parsed.data.makerspaceSlug, "refunds.manage");
  if (!ctx.ok) return ctx;
  const payment = await scopedPayment(ctx.makerspace.id, parsed.data.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  let created: Awaited<ReturnType<typeof createRefund>>;
  try {
    created = await prisma.$transaction((tx) => createRefund(tx, { makerspace: ctx.makerspace, paymentId: payment.id, amountMinor: parsed.data.amountMinor, reason: parsed.data.reason, actorUserId: ctx.access.userId }));
  } catch (error) {
    return paymentFailure(error);
  }
  const outcome = await sendRefundToGateway(ctx.makerspace, created);
  refresh(ctx, payment);
  return outcome.ok ? { ok: true, data: { status: outcome.status } } : outcome;
}
