import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { orgActionAccess, type OrgActionAccess } from "@/lib/permissions";
import type { Capability } from "@/lib/permissionRoles";
import { ORG_FOR_PAYMENTS, PaymentError, type OrgForPayments } from "./charges";
import { PaymentSecretsUnavailable } from "./secrets";

export type PaymentActionContext = { access: Extract<OrgActionAccess, { ok: true }>; org: OrgForPayments };

/** Team access for a payment action: capability, rate limit and the organisation's payment fields. */
export async function paymentAccess(slug: unknown, capability: Capability): Promise<{ ok: false; error: string } | ({ ok: true } & PaymentActionContext)> {
  const result = await orgActionAccess(slug, capability);
  if (!result.ok) return result;
  if (await isActionRateLimited("action", result.userId)) return { ok: false, error: "Too many requests. Try again shortly." };
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: result.organisation.id }, select: ORG_FOR_PAYMENTS });
  return { ok: true, access: result, org };
}

/** A payment in this organisation; null otherwise (treated as not found). */
export async function scopedPayment(organisationId: string, paymentId: string) {
  return prisma.payment.findFirst({ where: { id: paymentId, organisationId }, select: { id: true, bookingId: true, provider: true, status: true } });
}

/** Turn expected business errors into a message; anything else is a real failure and is rethrown. */
export function paymentFailure(error: unknown): { ok: false; error: string } {
  if (error instanceof PaymentError || error instanceof PaymentSecretsUnavailable) return { ok: false, error: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "That payment changed meanwhile, or the reference was already used. Reload and try again." };
  throw error;
}
