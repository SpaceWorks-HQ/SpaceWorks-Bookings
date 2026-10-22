"use server";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { currentRequestBlocked } from "@/lib/ipBlock";
import { issueMagicLink } from "@/lib/magicLink";
import type { ActionResult } from "./makerspace";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254) });

/**
 * Email a one-time sign-in link. The answer is the same whether or not the address has an account, is
 * rate limited, or comes from a blocked network, so it never reveals who has signed up.
 */
export async function requestMagicLink(input: unknown): Promise<ActionResult<{ sent: true }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email address.", fieldErrors: { email: ["Enter a valid email address"] } };
  // Per address and per IP: isActionRateLimited counts both keys.
  if ((await currentRequestBlocked()) || (await isActionRateLimited("magicLink", parsed.data.email))) return { ok: true, data: { sent: true } };
  const base = process.env.NEXT_PUBLIC_BASE_URL || process.env.AUTH_URL || "http://localhost:3000";
  await issueMagicLink(parsed.data.email, base);
  return { ok: true, data: { sent: true } };
}
