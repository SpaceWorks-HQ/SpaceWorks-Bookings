import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
  makerspaceFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  teamMemberFindUnique: vi.fn(),
  teamMemberCount: vi.fn(),
  teamMemberDeleteMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({
  prisma: {
    makerspace: { findUnique: mocks.makerspaceFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { leaveMakerspace } from "@/app/actions/account-makerspaces";

const tx = {
  $queryRaw: mocks.queryRaw,
  teamMember: {
    findUnique: mocks.teamMemberFindUnique,
    count: mocks.teamMemberCount,
    deleteMany: mocks.teamMemberDeleteMany,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.makerspaceFindUnique.mockResolvedValue({ id: "org_1", slug: "acme" });
  mocks.transaction.mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
  mocks.queryRaw.mockResolvedValue([{ id: "org_1" }]);
  mocks.teamMemberFindUnique.mockResolvedValue({ id: "membership_1", role: "VIEWER" });
  mocks.teamMemberCount.mockResolvedValue(1);
  mocks.teamMemberDeleteMany.mockResolvedValue({ count: 1 });
});

describe("leaveMakerspace", () => {
  it("rejects unauthenticated callers before touching the database", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(leaveMakerspace({ makerspaceSlug: "acme" })).resolves.toEqual({ ok: false, error: "You must be signed in." });
    expect(mocks.makerspaceFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("validates input", async () => {
    await expect(leaveMakerspace({ makerspaceSlug: "" })).resolves.toMatchObject({ ok: false, error: "Invalid input." });
    await expect(leaveMakerspace(null)).resolves.toMatchObject({ ok: false, error: "Invalid input." });
    expect(mocks.makerspaceFindUnique).not.toHaveBeenCalled();
  });

  it("honours the action rate limit for the caller", async () => {
    mocks.rateLimit.mockResolvedValue(true);
    await expect(leaveMakerspace({ makerspaceSlug: "acme" })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/too many/i) });
    expect(mocks.rateLimit).toHaveBeenCalledWith("action", "user_1");
    expect(mocks.makerspaceFindUnique).not.toHaveBeenCalled();
    expect(mocks.teamMemberDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown makerspace", async () => {
    mocks.makerspaceFindUnique.mockResolvedValue(null);
    await expect(leaveMakerspace({ makerspaceSlug: "missing" })).resolves.toEqual({ ok: false, error: "You are not on this makerspace's team." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a non-member without deleting anything", async () => {
    mocks.teamMemberFindUnique.mockResolvedValue(null);
    await expect(leaveMakerspace({ makerspaceSlug: "acme" })).resolves.toEqual({ ok: false, error: "You are not on this makerspace's team." });
    expect(mocks.teamMemberDeleteMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("blocks the last bookings manager, counting managers under the makerspace lock", async () => {
    mocks.teamMemberFindUnique.mockResolvedValue({ id: "membership_1", role: "BOOKINGS_MANAGER" });
    mocks.teamMemberCount.mockResolvedValue(1);
    const result = await leaveMakerspace({ makerspaceSlug: "acme" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("needs at least one bookings manager") });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.teamMemberCount.mock.invocationCallOrder[0]!);
    expect(mocks.teamMemberCount).toHaveBeenCalledWith({ where: { makerspaceId: "org_1", role: "BOOKINGS_MANAGER" } });
    expect(mocks.teamMemberDeleteMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(["VIEWER", "FRONT_DESK"] as const)("lets a %s leave without counting managers", async (role) => {
    mocks.teamMemberFindUnique.mockResolvedValue({ id: "membership_1", role });
    await expect(leaveMakerspace({ makerspaceSlug: "acme" })).resolves.toEqual({ ok: true });
    expect(mocks.teamMemberCount).not.toHaveBeenCalled();
    expect(mocks.teamMemberDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("lets a bookings manager leave when another one remains", async () => {
    mocks.teamMemberFindUnique.mockResolvedValue({ id: "membership_1", role: "BOOKINGS_MANAGER" });
    mocks.teamMemberCount.mockResolvedValue(2);
    await expect(leaveMakerspace({ makerspaceSlug: "acme" })).resolves.toEqual({ ok: true });
    expect(mocks.teamMemberDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("deletes only the caller's own membership and audits it in the same transaction", async () => {
    await expect(leaveMakerspace({ makerspaceSlug: " acme " })).resolves.toEqual({ ok: true });
    expect(mocks.makerspaceFindUnique).toHaveBeenCalledWith({ where: { slug: "acme" }, select: { id: true, slug: true } });
    expect(mocks.teamMemberFindUnique).toHaveBeenCalledWith({
      where: { userId_makerspaceId: { userId: "user_1", makerspaceId: "org_1" } },
      select: { id: true, role: true },
    });
    expect(mocks.teamMemberDeleteMany).toHaveBeenCalledWith({ where: { id: "membership_1", userId: "user_1", makerspaceId: "org_1" } });
    expect(mocks.audit).toHaveBeenCalledWith({
      action: "TEAM_MEMBER_LEFT",
      actorUserId: "user_1",
      makerspaceId: "org_1",
      targetType: "teamMember",
      targetId: "membership_1",
      metadata: { role: "VIEWER" },
      client: tx,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/account/makerspaces");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/acme");
  });

  it("ignores any extra target identifiers in the input", async () => {
    await leaveMakerspace({ makerspaceSlug: "acme", targetUserId: "someone_else", userId: "someone_else" });
    expect(mocks.teamMemberFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_makerspaceId: { userId: "user_1", makerspaceId: "org_1" } },
    }));
    expect(mocks.teamMemberDeleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: "user_1" }) });
  });

  it("does not audit or revalidate when the row vanished concurrently", async () => {
    mocks.teamMemberDeleteMany.mockResolvedValue({ count: 0 });
    await expect(leaveMakerspace({ makerspaceSlug: "acme" })).resolves.toMatchObject({ ok: false });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
