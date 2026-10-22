import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  rateLimit: vi.fn(),
  findSetting: vi.fn(),
  upsertSetting: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireSuperAdmin: mocks.requireSuperAdmin }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ prisma: { instanceSetting: { findUnique: mocks.findSetting, upsert: mocks.upsertSetting } } }));
vi.mock("@/lib/instanceConfigSecrets", () => ({ encryptInstanceConfigSecret: (value: string) => `encrypted:${value.length}` }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveSignInProviders } from "@/app/actions/sign-in-providers";

const appleKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperAdmin.mockResolvedValue({ user: { id: "admin_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.findSetting.mockResolvedValue(null);
});

describe("sign-in provider settings", () => {
  it("encrypts every secret and never stores plaintext", async () => {
    const result = await saveSignInProviders({
      googleClientId: "g-id", googleClientSecret: "g-secret",
      githubClientId: "gh-id", githubClientSecret: "gh-secret",
      appleClientId: "org.example.web", appleTeamId: "TEAM123456", appleKeyId: "KEY1234567", applePrivateKey: appleKey,
    });
    expect(result).toEqual({ ok: true });
    const { create } = mocks.upsertSetting.mock.calls[0][0];
    expect(create).toMatchObject({ googleClientId: "g-id", githubClientId: "gh-id", appleClientId: "org.example.web" });
    expect(create.googleClientSecretEncrypted).toMatch(/^encrypted:/);
    expect(create.githubClientSecretEncrypted).toMatch(/^encrypted:/);
    expect(create.applePrivateKeyEncrypted).toMatch(/^encrypted:/);
    expect(JSON.stringify(mocks.upsertSetting.mock.calls)).not.toContain("g-secret");
    expect(JSON.stringify(mocks.upsertSetting.mock.calls)).not.toContain("BEGIN PRIVATE KEY");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { google: true, github: true, apple: true } }));
  });

  it("requires a secret the first time a provider is switched on", async () => {
    expect(await saveSignInProviders({ githubClientId: "gh-id" })).toMatchObject({ ok: false });
    mocks.findSetting.mockResolvedValue({ githubClientSecretEncrypted: "kept" });
    expect(await saveSignInProviders({ githubClientId: "gh-id" })).toEqual({ ok: true });
    // A blank secret keeps the stored one: nothing is written over it.
    expect(mocks.upsertSetting.mock.calls[0][0].update).not.toHaveProperty("githubClientSecretEncrypted");
  });

  it("refuses an Apple key it cannot read, and incomplete Apple settings", async () => {
    expect(await saveSignInProviders({ appleClientId: "org.example.web", appleTeamId: "T", appleKeyId: "K", applePrivateKey: "not a key" })).toMatchObject({ ok: false });
    expect(await saveSignInProviders({ appleClientId: "org.example.web", applePrivateKey: appleKey })).toMatchObject({ ok: false });
    expect(mocks.upsertSetting).not.toHaveBeenCalled();
  });
});
