import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";
import type { CredentialsConfig } from "next-auth/providers/credentials";

const mocks = vi.hoisted(() => ({ config: null as unknown, find: vi.fn(), compare: vi.fn(), limit: vi.fn(), consume: vi.fn(), recovery: vi.fn() }));
vi.mock("next-auth", () => ({
  default: (config: unknown) => { mocks.config = config; return {}; },
  CredentialsSignin: class extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (options: unknown) => options }));
vi.mock("@/lib/loginSecurity", () => ({ recognisedDevice: async () => ({ id: "device_1" }), rememberDevice: async () => undefined, issueLoginCode: async () => undefined, consumeLoginCode: async () => true, justVerified: () => true }));
vi.mock("@/lib/ipBlock", () => ({ isIpBlocked: async () => false, recordFailedLogin: async () => false }));
vi.mock("@/lib/rateLimit", () => ({ getClientIpFromHeaders: () => "203.0.113.7" }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.limit }));
vi.mock("@/lib/mfa", () => ({ consumeMfaCode: mocks.consume, consumeRecoveryCode: mocks.recovery, decryptMfaSecret: () => "synthetic-seed" }));
import "@/lib/auth";
let config: NextAuthConfig;
beforeEach(async () => {
  vi.clearAllMocks();
  config = mocks.config as NextAuthConfig;
  mocks.limit.mockResolvedValue(false);
  mocks.compare.mockResolvedValue(true);
  mocks.find.mockResolvedValue({ id: "user_1", email: "person@example.test", emailVerified: new Date(), passwordHash: "hash", sessionVersion: 2 });
});
const jwt = (args: unknown) => config.callbacks!.jwt!(args as Parameters<NonNullable<NonNullable<NextAuthConfig["callbacks"]>["jwt"]>>[0]);
const authorize = (raw: Record<string, string>) => {
  const provider = config.providers[0] as CredentialsConfig;
  return provider.authorize(raw, new Request("https://example.test/api/auth/callback/credentials"));
};
describe("authentication boundary", () => {
  it("limits the normalized account before reading or hashing", async () => {
    mocks.limit.mockResolvedValue(true);
    expect(await authorize({ email: " PERSON@example.test ", password: "password" })).toBeNull();
    expect(mocks.limit).toHaveBeenCalledWith("auth", "person@example.test");
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });
  it("performs dummy password work for missing identities", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await authorize({ email: "person@example.test", password: "password" })).toBeNull();
    expect(mocks.compare).toHaveBeenCalledOnce();
  });
  it("rejects oversized credentials before expensive work", async () => {
    expect(await authorize({ email: "person@example.test", password: "a".repeat(129) })).toBeNull();
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("binds successful password proof to its session version", async () => {
    expect(await authorize({ email: "person@example.test", password: "password" })).toMatchObject({ id: "user_1", sessionVersion: 2 });
  });
  it("rejects a login racing credential revocation", async () => {
    expect(await jwt({ token: {}, user: { id: "user_1", sessionVersion: 1 } })).toBeNull();
  });
  it.each([{}, { sessionVersion: 1 }, { sessionVersion: 2, sessionRevoked: true }])("clears stale sessions %j", async (token) => {
    expect(await jwt({ token: { sub: "user_1", ...token } })).toBeNull();
  });
  it("does not let session updates renew authentication freshness", async () => {
    const token = { sub: "user_1", sessionVersion: 2, authenticatedAt: 123 };
    expect(await jwt({ token, trigger: "update", session: { authenticatedAt: Date.now(), sessionVersion: 99 } })).toEqual(token);
  });
  it("clears deleted users", async () => {
    mocks.find.mockResolvedValue(null);
    expect(await jwt({ token: { sub: "user_1", sessionVersion: 2 } })).toBeNull();
  });
  it("offers no single sign-on providers", () => {
    expect(config.providers.map((provider) => (provider as CredentialsConfig).id)).toEqual(["credentials"]);
  });
});
