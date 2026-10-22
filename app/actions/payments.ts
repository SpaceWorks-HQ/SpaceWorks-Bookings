"use server";

import { z } from "zod";
import { revalidatePath as nextRevalidatePath } from "next/cache";
import { trackedRevalidation } from "@/lib/frontend/revalidation";
import { prisma } from "@/lib/db";
import { cancelPayment, confirmOfflinePayment, rejectOfflinePayment } from "@/lib/payments/offline";
import { clearPaymentFlag, releaseHeldDocument } from "@/lib/payments/settle";
import { paymentAccess, paymentFailure, scopedPayment } from "@/lib/payments/actionContext";
import type { ActionResult } from "./makerspace";

const revalidatePath = trackedRevalidation(nextRevalidatePath);
const id = z.string().trim().min(1).max(64);
const slug = z.string().trim().min(1).max(64);

function refresh(makerspaceSlug: string, paymentId: string) {
  revalidatePath(`/dashboard/${makerspaceSlug}/payments`);
  revalidatePath(`/dashboard/${makerspaceSlug}`);
  revalidatePath(`/dashboard/${makerspaceSlug}/payments/${paymentId}`);
}

const paymentSchema = z.object({ makerspaceSlug: slug, paymentId: id });
const reasonSchema = paymentSchema.extend({ reason: z.string().trim().min(3, "Give a short reason").max(300) });

export async function confirmPayment(input: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await paymentAccess(parsed.data.makerspaceSlug, "payments.manage");
  if (!ctx.ok) return ctx;
  const payment = await scopedPayment(ctx.makerspace.id, parsed.data.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  try {
    await prisma.$transaction((tx) => confirmOfflinePayment(tx, { makerspace: ctx.makerspace, paymentId: payment.id, actorUserId: ctx.access.userId }));
    refresh(ctx.makerspace.slug, payment.id);
    return { ok: true };
  } catch (error) {
    return paymentFailure(error);
  }
}

export async function rejectPayment(input: unknown): Promise<ActionResult> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const ctx = await paymentAccess(parsed.data.makerspaceSlug, "payments.manage");
  if (!ctx.ok) return ctx;
  const payment = await scopedPayment(ctx.makerspace.id, parsed.data.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  try {
    await prisma.$transaction((tx) => rejectOfflinePayment(tx, { makerspace: ctx.makerspace, paymentId: payment.id, actorUserId: ctx.access.userId, reason: parsed.data.reason }));
    refresh(ctx.makerspace.slug, payment.id);
    return { ok: true };
  } catch (error) {
    return paymentFailure(error);
  }
}

export async function cancelOpenPayment(input: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await paymentAccess(parsed.data.makerspaceSlug, "payments.manage");
  if (!ctx.ok) return ctx;
  const payment = await scopedPayment(ctx.makerspace.id, parsed.data.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  try {
    await prisma.$transaction((tx) => cancelPayment(tx, { makerspace: ctx.makerspace, paymentId: payment.id, actorUserId: ctx.access.userId }));
    refresh(ctx.makerspace.slug, payment.id);
    return { ok: true };
  } catch (error) {
    return paymentFailure(error);
  }
}

/** Accept a mismatched gateway amount and issue the held receipt on what was actually received. */
export async function releaseDocument(input: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await paymentAccess(parsed.data.makerspaceSlug, "payments.manage");
  if (!ctx.ok) return ctx;
  const payment = await scopedPayment(ctx.makerspace.id, parsed.data.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  try {
    await prisma.$transaction((tx) => releaseHeldDocument(tx, { makerspace: ctx.makerspace, paymentId: payment.id, actorUserId: ctx.access.userId }));
    refresh(ctx.makerspace.slug, payment.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "This payment has no held document.") return { ok: false, error: error.message };
    return paymentFailure(error);
  }
}

export async function clearFlag(input: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const ctx = await paymentAccess(parsed.data.makerspaceSlug, "payments.manage");
  if (!ctx.ok) return ctx;
  const payment = await scopedPayment(ctx.makerspace.id, parsed.data.paymentId);
  if (!payment) return { ok: false, error: "Payment not found." };
  try {
    await prisma.$transaction((tx) => clearPaymentFlag(tx, { makerspace: ctx.makerspace, paymentId: payment.id, actorUserId: ctx.access.userId }));
    refresh(ctx.makerspace.slug, payment.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "Nothing to clear on this payment.") return { ok: false, error: error.message };
    return paymentFailure(error);
  }
}
