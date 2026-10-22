import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => new Map<string, string>());
// Auth.js itself is not loaded here (it needs the Next runtime); its error base class is enough.
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error { code = "credentials"; } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "198.51.100.42", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0" }),
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined), set: (name: string, value: string) => void jar.set(name, value) }),
}));

process.env.MFA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { prisma } = await import("@/lib/db");
const { requestMagicLink } = await import("@/app/actions/magic-link");
const { authorizeMagicLink, hashMagicLinkToken } = await import("@/lib/magicLink");
const { createMfaEnrollment, encryptMfaSecret } = await import("@/lib/mfa");
const { TOTP, Secret } = await import("otpauth");

const tag = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${tag}@example.test`;
const request = new Request("http://localhost/api/auth/callback/magic-link", { headers: { "x-real-ip": "198.51.100.42" } });

/** The raw token from the queued email, the way the person's inbox would see it. */
async function linkFor(address: string) {
  const row = await prisma.outboxMessage.findFirstOrThrow({ where: { kind: "magic-link", payload: { path: ["to"], equals: address } }, orderBy: { createdAt: "desc" } });
  return new URL((row.payload as { url: string }).url).searchParams.get("token")!;
}

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
  await prisma.outboxMessage.deleteMany({ where: { payload: { path: ["to"], string_contains: tag } } });
  await prisma.outboxMessage.deleteMany({ where: { kind: "login-alert", OR: users.map((user) => ({ payload: { path: ["userId"], equals: user.id } })) } });
  await prisma.verificationToken.deleteMany({ where: { identifier: { contains: tag } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.$disconnect();
});

describe.sequential("magic link sign-in", () => {
  it("emails a link only to existing accounts, stores only its hash, and answers the same either way", async () => {
    await prisma.user.create({ data: { email: email("ada"), name: "Ada" } });
    await expect(requestMagicLink({ email: email("ada") })).resolves.toEqual({ ok: true, data: { sent: true } });
    await expect(requestMagicLink({ email: email("nobody") })).resolves.toEqual({ ok: true, data: { sent: true } });
    const token = await linkFor(email("ada"));
    expect(await prisma.verificationToken.count({ where: { identifier: `magic-link:${email("ada")}`, token: hashMagicLinkToken(token) } })).toBe(1);
    expect(await prisma.verificationToken.count({ where: { token } })).toBe(0);
    expect(await prisma.outboxMessage.count({ where: { kind: "magic-link", payload: { path: ["to"], equals: email("nobody") } } })).toBe(0);
  });

  it("signs in once, verifies the address and then refuses the same link", async () => {
    const token = await linkFor(email("ada"));
    const user = await authorizeMagicLink({ token }, request);
    expect(user).toMatchObject({ email: email("ada") });
    expect((await prisma.user.findUniqueOrThrow({ where: { email: email("ada") } })).emailVerified).not.toBeNull();
    expect(await prisma.knownDevice.count({ where: { userId: user!.id } })).toBe(1);
    await expect(authorizeMagicLink({ token }, request)).rejects.toMatchObject({ code: "magic_link_invalid" });
  });

  it("refuses an expired link", async () => {
    await requestMagicLink({ email: email("ada") });
    const token = await linkFor(email("ada"));
    await prisma.verificationToken.updateMany({ where: { token: hashMagicLinkToken(token) }, data: { expires: new Date(Date.now() - 1000) } });
    await expect(authorizeMagicLink({ token }, request)).rejects.toMatchObject({ code: "magic_link_invalid" });
  });

  it("still asks for the authenticator, and keeps the link until the code is right", async () => {
    const enrollment = createMfaEnrollment(email("grace"));
    await prisma.user.create({ data: { email: email("grace"), emailVerified: new Date(), mfaSecretEncrypted: encryptMfaSecret(enrollment.secret), mfaEnabledAt: new Date() } });
    await requestMagicLink({ email: email("grace") });
    const token = await linkFor(email("grace"));
    await expect(authorizeMagicLink({ token }, request)).rejects.toMatchObject({ code: "mfa_required" });
    expect(await authorizeMagicLink({ token, totp: "000000" }, request)).toBeNull();
    const code = new TOTP({ secret: Secret.fromBase32(enrollment.secret), digits: 6, period: 30 }).generate();
    await expect(authorizeMagicLink({ token, totp: code }, request)).resolves.toMatchObject({ email: email("grace") });
    expect(await prisma.verificationToken.count({ where: { token: hashMagicLinkToken(token) } })).toBe(0);
  });

  it("never sends a link to a super admin", async () => {
    await prisma.user.create({ data: { email: email("root"), emailVerified: new Date(), isSuperAdmin: true } });
    await requestMagicLink({ email: email("root") });
    expect(await prisma.outboxMessage.count({ where: { kind: "magic-link", payload: { path: ["to"], equals: email("root") } } })).toBe(0);
  });
});
