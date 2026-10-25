import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Booking secrets and codes.
 * - Manage token: 32 random bytes (base64url). Only its sha256 is stored; it is emailed and returned once.
 * - Reference: BK- and six Crockford base32 characters (no I, L, O or U), unique per makerspace.
 * - Check-in code: the reference and an HMAC of it, for QR scans and self check-in. It only checks people in; it
 *   never opens the manage page.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERENCE_PATTERN = /^BK-[0-9A-HJKMNP-TV-Z]{6}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function manageTokenMatches(token: string | null | undefined, hash: string): boolean {
  if (!token || token.length > 128) return false;
  const supplied = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function newReference(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) code += CROCKFORD[randomInt(CROCKFORD.length)];
  return `BK-${code}`;
}

function checkInKey() {
  return createHash("sha256").update(`swb:check-in:${process.env.AUTH_SECRET ?? ""}`).digest();
}

function checkInMac(makerspaceId: string, reference: string): string {
  const digest = createHmac("sha256", checkInKey()).update(`${makerspaceId}:${reference}`).digest();
  let out = "";
  for (let index = 0; index < 8; index += 1) out += CROCKFORD[digest[index] % 32];
  return out;
}

/** "BK-7Q2M9X-3HF8K2PA": printed on confirmations and encoded in the check-in QR. */
export function checkInCode(makerspaceId: string, reference: string): string {
  return `${reference}-${checkInMac(makerspaceId, reference)}`;
}

/** The reference a code belongs to, if the code is genuine for this makerspace. */
export function verifyCheckInCode(makerspaceId: string, code: string): string | null {
  const match = /^(BK-[0-9A-HJKMNP-TV-Z]{6})-([0-9A-HJKMNP-TV-Z]{8})$/.exec(code.trim().toUpperCase());
  if (!match) return null;
  const expected = Buffer.from(checkInMac(makerspaceId, match[1]));
  const supplied = Buffer.from(match[2]);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? match[1] : null;
}
