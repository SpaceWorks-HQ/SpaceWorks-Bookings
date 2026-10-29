import "server-only";

import { ZodError } from "zod";
import { checkRateLimitById } from "@/lib/rateLimit";
import { authenticateApiKey, type ApiKeyContext, type ApiScope } from "@/lib/integrations/apiKeys";
import { BookingError, isExclusionViolation, SLOT_TAKEN_MESSAGE } from "@/lib/bookings/errors";
import type { StaffActor } from "@/lib/bookings/actor";

/**
 * The REST API (`/api/v1`, docs/API.md). Every call: a bearer API key of an ACTIVE makerspace, the scope the route
 * needs, a per-key rate limit (reads 600/min, writes 60/min), JSON in and out, errors as
 * `{ "error": { "code", "message", "fields"? } }`. Keys have independent scoped service authority; writes are
 * attributed to their creator with manager booking capabilities, never rule overrides (docs/API.md).
 */

export type ApiContext = ApiKeyContext & { actor: StaffActor };

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

export function apiJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

export function apiError(status: number, code: string, message: string, fields?: Record<string, string>) {
  return apiJson({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

function failure(error: unknown) {
  if (error instanceof ZodError) {
    return apiError(422, "INVALID_INPUT", "Check the request fields.", Object.fromEntries(error.issues.map((issue) => [issue.path.join(".") || "body", issue.message])));
  }
  if (isExclusionViolation(error) || (error instanceof BookingError && error.code === "SLOT_TAKEN")) return apiError(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE);
  if (error instanceof BookingError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "INVALID_INPUT" ? 422 : 409;
    return apiError(status, error.code, error.message, Object.keys(error.fields).length ? error.fields : undefined);
  }
  console.error("[api] request failed", error instanceof Error ? error.name : typeof error);
  return apiError(500, "INTERNAL", "Something on our side failed. Try again shortly.");
}

export async function apiHandler(request: Request, scope: ApiScope, operation: (context: ApiContext) => Promise<Response>): Promise<Response> {
  const key = await authenticateApiKey(request.headers.get("authorization"));
  if (!key || !key.createdById) return apiError(401, "INVALID_KEY", "Send a valid API key as `Authorization: Bearer swb_…`.");
  if (!key.scopes.has(scope)) return apiError(403, "INSUFFICIENT_SCOPE", `This key lacks the ${scope} scope.`);
  if (!(await checkRateLimitById(scope === "write" ? "apiWrite" : "apiRead", key.keyId))) return apiError(429, "RATE_LIMITED", "Too many requests. Slow down and try again in a minute.");
  try {
    return await operation({ ...key, actor: { kind: "STAFF", userId: key.createdById, role: scope === "write" ? "BOOKINGS_MANAGER" : "VIEWER" } });
  } catch (error) {
    return failure(error);
  }
}

/** Read a JSON body (max 64 KB); invalid JSON answers 400 through `failure` as INVALID_INPUT. */
export async function jsonBody(request: Request): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  const reader = request.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65_536) {
          await reader.cancel();
          throw new BookingError("INVALID_INPUT", "The request body is too large.");
        }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new BookingError("INVALID_INPUT", "The request body isn't valid JSON.");
  }
}
