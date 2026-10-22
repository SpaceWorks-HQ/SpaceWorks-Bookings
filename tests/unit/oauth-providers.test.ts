import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { instanceSetting: { findUnique: vi.fn().mockResolvedValue(null) } } }));

import { providerVerifiedEmail } from "@/lib/oauthProviders";

afterEach(() => vi.unstubAllGlobals());

describe("provider email verification", () => {
  it("accepts Google only with an explicit verified claim", async () => {
    expect(await providerVerifiedEmail("google", { email_verified: true }, undefined, "a@example.com")).toBe(true);
    expect(await providerVerifiedEmail("google", { email_verified: false }, undefined, "a@example.com")).toBe(false);
    expect(await providerVerifiedEmail("google", {}, undefined, "a@example.com")).toBe(false);
    expect(await providerVerifiedEmail("google", null, undefined, "a@example.com")).toBe(false);
  });

  it("accepts Apple's boolean or string claim", async () => {
    expect(await providerVerifiedEmail("apple", { email_verified: "true" }, undefined, "a@example.com")).toBe(true);
    expect(await providerVerifiedEmail("apple", { email_verified: true }, undefined, "a@example.com")).toBe(true);
    expect(await providerVerifiedEmail("apple", { email_verified: "false" }, undefined, "a@example.com")).toBe(false);
  });

  it("checks GitHub's verified email list for the exact address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ email: "A@Example.com", verified: true }, { email: "other@example.com", verified: false }])));
    vi.stubGlobal("fetch", fetchMock);
    expect(await providerVerifiedEmail("github", {}, "token", "a@example.com")).toBe(true);
    expect(await providerVerifiedEmail("github", {}, "token", "other@example.com")).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/user/emails", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }));
    expect(await providerVerifiedEmail("github", {}, undefined, "a@example.com")).toBe(false);
  });

  it("refuses unknown providers", async () => {
    expect(await providerVerifiedEmail("twitter", { email_verified: true }, "token", "a@example.com")).toBe(false);
  });
});
