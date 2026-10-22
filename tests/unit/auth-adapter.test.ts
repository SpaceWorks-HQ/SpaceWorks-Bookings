import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), link: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({ linkAccount: mocks.link }) }));
import { authAdapter } from "@/lib/authAdapter";
beforeEach(() => vi.clearAllMocks());
it("rejects unverified password identities at the adapter linking lookup", async () => {
  mocks.find.mockResolvedValue({ email: "person@example.test", passwordHash: "hash", emailVerified: null });
  await expect(authAdapter.getUserByEmail!("PERSON@example.test")).rejects.toThrow();
});
it("returns only identity fields for verified users", async () => {
  mocks.find.mockResolvedValue({ id: "u", email: "person@example.test", emailVerified: new Date(), passwordHash: "hash", mfaSecretEncrypted: "secret" });
  const user = await authAdapter.getUserByEmail!("person@example.test");
  expect(user).not.toHaveProperty("passwordHash");
  expect(user).not.toHaveProperty("mfaSecretEncrypted");
});
it("does not persist Google bearer tokens", async () => {
  await authAdapter.linkAccount!({ userId: "u", type: "oidc", provider: "google", providerAccountId: "g", access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: "synthetic-id" });
  expect(mocks.link).toHaveBeenCalledWith({ userId: "u", type: "oidc", provider: "google", providerAccountId: "g" });
});
