import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: null as string | null, ip: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => identity.userId ? { user: { id: identity.userId }, authenticatedAt: Date.now() } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": identity.ip }) }));

import { prisma } from "@/lib/db";
import { removeTeamMember, updateTeamRole } from "@/app/actions/team";
import { leaveMakerspace } from "@/app/actions/account-makerspaces";
import { LAST_MANAGER_MESSAGE } from "@/lib/teamManagers";
import { NOW } from "./bookings-helpers";
import { resetActionRequest, setupActionMakerspace, type ActionFixture } from "./booking-actions-helpers";

let fixture: ActionFixture;

async function manager() {
  const user = await prisma.user.create({ data: { email: `manager-${crypto.randomUUID()}@example.test`, emailVerified: NOW, mfaEnabledAt: NOW } });
  await prisma.teamMember.create({ data: { userId: user.id, makerspaceId: fixture.makerspaceId, role: "BOOKINGS_MANAGER" } });
  return user.id;
}
const roleOf = async (userId: string) => (await prisma.teamMember.findFirst({ where: { userId, makerspaceId: fixture.makerspaceId } }))?.role ?? null;

describe.sequential("the last bookings manager", () => {
  beforeAll(async () => { fixture = await setupActionMakerspace(); });
  beforeEach(() => { resetActionRequest(identity); identity.userId = fixture.owner.userId; });
  afterAll(async () => {
    await prisma.teamMember.deleteMany({ where: { makerspaceId: fixture.makerspaceId, userId: { not: fixture.owner.userId } } });
    await fixture.cleanup();
  });

  it("cannot demote themselves or leave while they are the only one", async () => {
    expect(await updateTeamRole({ ...fixture.scope, targetUserId: fixture.owner.userId, role: "VIEWER" })).toEqual({ ok: false, error: LAST_MANAGER_MESSAGE });
    expect(await leaveMakerspace(fixture.scope)).toEqual({ ok: false, error: LAST_MANAGER_MESSAGE });
    expect(await roleOf(fixture.owner.userId)).toBe("BOOKINGS_MANAGER");
  });

  it("lets managers manage other managers while one remains", async () => {
    const second = await manager();
    const front = (await fixture.staff("FRONT_DESK")).userId;
    expect(await updateTeamRole({ ...fixture.scope, targetUserId: front, role: "BOOKINGS_MANAGER" })).toEqual({ ok: true });
    expect(await removeTeamMember({ ...fixture.scope, targetUserId: front })).toEqual({ ok: true });
    expect(await updateTeamRole({ ...fixture.scope, targetUserId: second, role: "FRONT_DESK" })).toEqual({ ok: true });
    expect(await roleOf(second)).toBe("FRONT_DESK");
    expect(await prisma.auditEvent.findFirst({ where: { makerspaceId: fixture.makerspaceId, action: "TEAM_ROLE_CHANGED" }, orderBy: { createdAt: "desc" } }))
      .toMatchObject({ metadata: { role: "FRONT_DESK", from: "BOOKINGS_MANAGER" } });
  });

  it("refuses non-managers any team change", async () => {
    const front = (await fixture.staff("FRONT_DESK")).userId;
    identity.userId = front;
    expect(await updateTeamRole({ ...fixture.scope, targetUserId: fixture.owner.userId, role: "VIEWER" })).toMatchObject({ ok: false });
    expect(await removeTeamMember({ ...fixture.scope, targetUserId: fixture.owner.userId })).toMatchObject({ ok: false });
    expect(await roleOf(fixture.owner.userId)).toBe("BOOKINGS_MANAGER");
  });

  it("keeps one manager when two step down at the same time", async () => {
    const second = await manager();
    identity.userId = fixture.owner.userId;
    const results = await Promise.all([
      updateTeamRole({ ...fixture.scope, targetUserId: fixture.owner.userId, role: "VIEWER" }),
      updateTeamRole({ ...fixture.scope, targetUserId: second, role: "VIEWER" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, error: LAST_MANAGER_MESSAGE });
    expect(await prisma.teamMember.count({ where: { makerspaceId: fixture.makerspaceId, role: "BOOKINGS_MANAGER" } })).toBe(1);
  });
});
