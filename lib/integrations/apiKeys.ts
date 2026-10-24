import "server-only";

import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";

/**
 * REST API keys, one makerspace each: `swb_<prefix>_<secret>`. The prefix identifies the key (shown in the UI); only
 * a SHA-256 of the secret is stored, compared in constant time. Scopes: `read` (spaces, availability, bookings) and
 * `write` (create and cancel bookings, member rates). Keys stop working when revoked or when the makerspace isn't
 * ACTIVE; usage is recorded at most once an hour.
 */

export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export type ApiKeyContext = { keyId: string; makerspaceId: string; scopes: ReadonlySet<ApiScope>; createdById: string | null };

const KEY_PATTERN = /^swb_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;
const hash = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");

/** The parts of a presented key, or null (pure). */
export function parseApiKey(authorization: string | null): { prefix: string; secret: string } | null {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  const key = match ? KEY_PATTERN.exec(match[1]) : null;
  return key ? { prefix: key[1], secret: key[2] } : null;
}

export async function createApiKey(input: { makerspaceId: string; name: string; scopes: ApiScope[]; actorUserId: string }) {
  const prefix = crypto.randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(12, "0").slice(0, 12);
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = await prisma.$transaction(async (tx) => {
    const created = await tx.apiKey.create({ data: { makerspaceId: input.makerspaceId, name: input.name, prefix, secretHash: hash(secret), scopes: [...new Set(input.scopes)], createdById: input.actorUserId } });
    await recordAuditEvent({ action: "API_KEY_CREATED", actorUserId: input.actorUserId, makerspaceId: input.makerspaceId, targetType: "ApiKey", targetId: created.id, metadata: { scopes: created.scopes.join(",") }, client: tx });
    return created;
  });
  return { id: key.id, prefix, token: `swb_${prefix}_${secret}` };
}

export async function revokeApiKey(input: { makerspaceId: string; keyId: string; actorUserId: string }) {
  const revoked = await prisma.apiKey.updateMany({ where: { id: input.keyId, makerspaceId: input.makerspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (revoked.count) await recordAuditEvent({ action: "API_KEY_REVOKED", actorUserId: input.actorUserId, makerspaceId: input.makerspaceId, targetType: "ApiKey", targetId: input.keyId });
  return revoked.count === 1;
}

export async function authenticateApiKey(authorization: string | null, now = new Date()): Promise<ApiKeyContext | null> {
  const parsed = parseApiKey(authorization);
  if (!parsed) return null;
  const key = await prisma.apiKey.findUnique({ where: { prefix: parsed.prefix }, include: { makerspace: { select: { status: true } } } });
  if (!key || key.revokedAt || key.makerspace.status !== "ACTIVE") return null;
  const presented = Buffer.from(hash(parsed.secret), "hex");
  const stored = Buffer.from(key.secretHash, "hex");
  if (presented.length !== stored.length || !crypto.timingSafeEqual(presented, stored)) return null;
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60 * 60_000) {
    await prisma.apiKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return { keyId: key.id, makerspaceId: key.makerspaceId, scopes: new Set(key.scopes.filter((scope): scope is ApiScope => (API_SCOPES as readonly string[]).includes(scope))), createdById: key.createdById };
}
