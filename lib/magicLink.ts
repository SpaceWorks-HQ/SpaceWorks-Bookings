import "server-only";

import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { enqueueOutbox } from "@/lib/outbox";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { consumeMfaCode, consumeRecoveryCode, decryptMfaSecret } from "@/lib/mfa";
import { isIpBlocked, recordFailedLogin } from "@/lib/ipBlock";
import { recognisedDevice, rememberDevice } from "@/lib/loginSecurity";
import { getClientIpFromHeaders } from "@/lib/rateLimit";
import { AddressBlockedError, MagicLinkInvalidError, MfaRequiredError, SuperAdminPasswordOnlyError } from "@/lib/authErrors";

/**
 * Sign-in by emailed link. The token is 32 random bytes; only its SHA-256 is stored, as a VerificationToken
 * with the identifier `magic-link:<email>`, for 15 minutes. Opening the link never signs anyone in by itself
 * (mail scanners open links): the page posts the token to the `magic-link` Credentials provider, which asks
 * for the authenticator when the account has one and uses the token up only once sign-in succeeds.
 */
export const MAGIC_LINK_TTL_MS = 15 * 60_000;
export const MAGIC_LINK_PREFIX = "magic-link:";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashMagicLinkToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const magicLinkIdentifier = (email: string) => `${MAGIC_LINK_PREFIX}${email.trim().toLowerCase()}`;

/**
 * Create a link for an existing account and queue its email in one transaction. Nothing is sent for unknown
 * addresses or super admins; callers answer the same either way, so the response never reveals an account.
 */
export async function issueMagicLink(email: string, baseUrl: string, now = Date.now()) {
  const address = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: address }, select: { id: true, isSuperAdmin: true } });
  if (!user || user.isSuperAdmin) return false;
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(now + MAGIC_LINK_TTL_MS);
  const url = `${baseUrl.replace(/\/$/, "")}/login/magic?token=${token}`;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    // One live link per account: asking again replaces the earlier one.
    await tx.verificationToken.deleteMany({ where: { identifier: magicLinkIdentifier(address) } });
    await tx.verificationToken.create({ data: { identifier: magicLinkIdentifier(address), token: hashMagicLinkToken(token), expires } });
    await enqueueOutbox(tx, "magic-link", { to: address, url, expiresAt: expires.toISOString() });
  });
  return true;
}

const credentialsSchema = z.object({ token: z.string().regex(TOKEN_PATTERN), totp: z.string().trim().max(32).optional() });

/** The Credentials `authorize` for the magic-link provider. Every refusal counts towards blocking the address. */
export async function authorizeMagicLink(raw: Partial<Record<string, unknown>> | undefined, request: Request) {
  const ip = getClientIpFromHeaders(request.headers);
  if (await isIpBlocked(ip)) throw new AddressBlockedError();
  const refuse = async (error: Error = new MagicLinkInvalidError()) => {
    if (await recordFailedLogin(ip)) throw new AddressBlockedError();
    throw error;
  };
  const parsed = credentialsSchema.safeParse(raw ?? {});
  if (!parsed.success) return refuse();
  const tokenHash = hashMagicLinkToken(parsed.data.token);
  const row = await prisma.verificationToken.findUnique({ where: { token: tokenHash }, select: { identifier: true, expires: true } });
  if (!row || !row.identifier.startsWith(MAGIC_LINK_PREFIX) || row.expires <= new Date()) return refuse();
  const email = row.identifier.slice(MAGIC_LINK_PREFIX.length);
  if (await isActionRateLimited("auth", email)) return refuse();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, image: true, sessionVersion: true, emailVerified: true, mfaSecretEncrypted: true, isSuperAdmin: true },
  });
  if (!user?.email) return refuse();
  if (user.isSuperAdmin) {
    await prisma.verificationToken.deleteMany({ where: { token: tokenHash } });
    return refuse(new SuperAdminPasswordOnlyError());
  }
  if (user.mfaSecretEncrypted) {
    const code = parsed.data.totp ?? "";
    if (!code) throw new MfaRequiredError();
    const valid = (await consumeMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, code)) || (await consumeRecoveryCode(user.id, code));
    if (!valid) {
      if (await recordFailedLogin(ip)) throw new AddressBlockedError();
      return null;
    }
  }
  // Single use: only the request that deletes the row signs in.
  const used = await prisma.verificationToken.deleteMany({ where: { token: tokenHash, identifier: row.identifier, expires: { gt: new Date() } } });
  if (used.count !== 1) return refuse();
  // Opening the link proved the inbox.
  if (!user.emailVerified) await prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
  await rememberDevice(user.id, await recognisedDevice(user.id));
  return { id: user.id, name: user.name, email: user.email, image: user.image, sessionVersion: user.sessionVersion };
}
