import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFind: vi.fn(), userUpdate: vi.fn(), tokenFind: vi.fn(), tokenDelete: vi.fn(), tokenCreate: vi.fn(), queryRaw: vi.fn(), enqueue: vi.fn(),
  limited: vi.fn(), blocked: vi.fn(), failed: vi.fn(), consumeMfa: vi.fn(), consumeRecovery: vi.fn(), recognised: vi.fn(), remember: vi.fn(), requestBlocked: vi.fn(),
}));

vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error { code = "credentials"; } }));
vi.mock("@/lib/db", () => {
  const prisma = {
    user: { findUnique: mocks.userFind, update: mocks.userUpdate },
    verificationToken: { findUnique: mocks.tokenFind, deleteMany: mocks.tokenDelete, create: mocks.tokenCreate },
    $queryRaw: mocks.queryRaw,
    $transaction: async (run: (tx: unknown) => unknown) => run(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/outbox", () => ({ enqueueOutbox: mocks.enqueue }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limited }));
vi.mock("@/lib/ipBlock", () => ({ isIpBlocked: mocks.blocked, recordFailedLogin: mocks.failed, currentRequestBlocked: mocks.requestBlocked }));
vi.mock("@/lib/mfa", () => ({ consumeMfaCode: mocks.consumeMfa, consumeRecoveryCode: mocks.consumeRecovery, decryptMfaSecret: () => "seed" }));
vi.mock("@/lib/loginSecurity", () => ({ recognisedDevice: mocks.recognised, rememberDevice: mocks.remember }));
vi.mock("@/lib/rateLimit", () => ({ getClientIpFromHeaders: () => "203.0.113.9" }));

import { authorizeMagicLink, hashMagicLinkToken, issueMagicLink, MAGIC_LINK_TTL_MS } from "@/lib/magicLink";
import { requestMagicLink } from "@/app/actions/magic-link";

const TOKEN = "A".repeat(43);
const request = new Request("https://book.example.test/api/auth/callback/magic-link");
const person = { id: "user_1", name: "Ada", email: "ada@example.test", image: null, sessionVersion: 3, emailVerified: new Date(), mfaSecretEncrypted: null, isSuperAdmin: false };
const live = { identifier: "magic-link:ada@example.test", expires: new Date(Date.now() + 60_000) };
const authorize = (raw: Record<string, string>) => authorizeMagicLink(raw, request);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limited.mockResolvedValue(false);
  mocks.blocked.mockResolvedValue(false);
  mocks.failed.mockResolvedValue(false);
  mocks.requestBlocked.mockResolvedValue(false);
  mocks.tokenFind.mockResolvedValue(live);
  mocks.tokenDelete.mockResolvedValue({ count: 1 });
  mocks.userFind.mockResolvedValue(person);
  mocks.recognised.mockResolvedValue(null);
});

describe("issuing a sign-in link", () => {
  it("stores only the hash for 15 minutes and emails the raw token once", async () => {
    mocks.userFind.mockResolvedValue({ id: "user_1", isSuperAdmin: false });
    const now = Date.UTC(2026, 9, 23, 10);
    expect(await issueMagicLink(" ADA@example.test ", "https://book.example.test/", now)).toBe(true);
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { identifier: "magic-link:ada@example.test" } });
    const stored = mocks.tokenCreate.mock.calls[0][0].data;
    expect(stored.identifier).toBe("magic-link:ada@example.test");
    expect(stored.expires.getTime()).toBe(now + MAGIC_LINK_TTL_MS);
    const [, kind, payload] = mocks.enqueue.mock.calls[0];
    expect(kind).toBe("magic-link");
    const token = new URL(payload.url).searchParams.get("token")!;
    expect(payload.url.startsWith("https://book.example.test/login/magic?token=")).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.token).toBe(hashMagicLinkToken(token));
    expect(stored.token).not.toContain(token);
  });

  it("sends nothing for unknown addresses or super admins", async () => {
    mocks.userFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "admin", isSuperAdmin: true });
    expect(await issueMagicLink("nobody@example.test", "https://x.test")).toBe(false);
    expect(await issueMagicLink("admin@example.test", "https://x.test")).toBe(false);
    expect(mocks.tokenCreate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("answers the same whether or not the account exists, and when limited or blocked", async () => {
    mocks.userFind.mockResolvedValue(null);
    await expect(requestMagicLink({ email: "nobody@example.test" })).resolves.toEqual({ ok: true, data: { sent: true } });
    mocks.limited.mockResolvedValue(true);
    await expect(requestMagicLink({ email: "ada@example.test" })).resolves.toEqual({ ok: true, data: { sent: true } });
    mocks.limited.mockResolvedValue(false);
    mocks.requestBlocked.mockResolvedValue(true);
    await expect(requestMagicLink({ email: "ada@example.test" })).resolves.toEqual({ ok: true, data: { sent: true } });
    expect(mocks.limited).toHaveBeenCalledWith("magicLink", "ada@example.test");
    expect((await requestMagicLink({ email: "not an email" })).ok).toBe(false);
  });
});

describe("signing in with a link", () => {
  it("signs in once, verifies the email and remembers the browser", async () => {
    mocks.userFind.mockResolvedValue({ ...person, emailVerified: null });
    await expect(authorize({ token: TOKEN })).resolves.toEqual({ id: "user_1", name: "Ada", email: "ada@example.test", image: null, sessionVersion: 3 });
    expect(mocks.tokenFind).toHaveBeenCalledWith(expect.objectContaining({ where: { token: hashMagicLinkToken(TOKEN) } }));
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { token: hashMagicLinkToken(TOKEN), identifier: live.identifier, expires: { gt: expect.any(Date) } } });
    expect(mocks.userUpdate).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { emailVerified: expect.any(Date) } });
    expect(mocks.remember).toHaveBeenCalledWith("user_1", null);
  });

  it.each([
    ["a malformed token", { token: "short" }, undefined],
    ["an unknown token", { token: TOKEN }, null],
    ["an expired token", { token: TOKEN }, { ...live, expires: new Date(Date.now() - 1) }],
    ["another kind of token", { token: TOKEN }, { ...live, identifier: "reset:ada@example.test" }],
  ])("refuses %s and counts it against the address", async (_label, raw, row) => {
    if (row !== undefined) mocks.tokenFind.mockResolvedValue(row);
    await expect(authorize(raw)).rejects.toMatchObject({ code: "magic_link_invalid" });
    expect(mocks.failed).toHaveBeenCalledWith("203.0.113.9");
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("refuses a link that was used meanwhile", async () => {
    mocks.tokenDelete.mockResolvedValue({ count: 0 });
    await expect(authorize({ token: TOKEN })).rejects.toMatchObject({ code: "magic_link_invalid" });
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("refuses blocked addresses before reading the token", async () => {
    mocks.blocked.mockResolvedValue(true);
    await expect(authorize({ token: TOKEN })).rejects.toMatchObject({ code: "address_blocked" });
    expect(mocks.tokenFind).not.toHaveBeenCalled();
  });

  it("never signs a super admin in by link", async () => {
    mocks.userFind.mockResolvedValue({ ...person, isSuperAdmin: true });
    await expect(authorize({ token: TOKEN })).rejects.toMatchObject({ code: "super_admin_password_only" });
    expect(mocks.tokenDelete).toHaveBeenCalledWith({ where: { token: hashMagicLinkToken(TOKEN) } });
    expect(mocks.remember).not.toHaveBeenCalled();
  });

  it("asks for the authenticator and keeps the link until the code is right", async () => {
    mocks.userFind.mockResolvedValue({ ...person, mfaSecretEncrypted: "enc" });
    await expect(authorize({ token: TOKEN })).rejects.toMatchObject({ code: "mfa_required" });
    mocks.consumeMfa.mockResolvedValue(false);
    mocks.consumeRecovery.mockResolvedValue(false);
    await expect(authorize({ token: TOKEN, totp: "000000" })).resolves.toBeNull();
    expect(mocks.failed).toHaveBeenCalledOnce();
    expect(mocks.tokenDelete).not.toHaveBeenCalled();
    mocks.consumeMfa.mockResolvedValue(true);
    await expect(authorize({ token: TOKEN, totp: "123456" })).resolves.toMatchObject({ id: "user_1" });
    expect(mocks.tokenDelete).toHaveBeenCalledOnce();
  });

  it("respects the per-account sign-in limit", async () => {
    mocks.limited.mockResolvedValue(true);
    await expect(authorize({ token: TOKEN })).rejects.toMatchObject({ code: "magic_link_invalid" });
    expect(mocks.limited).toHaveBeenCalledWith("auth", "ada@example.test");
    expect(mocks.userFind).not.toHaveBeenCalled();
  });
});
