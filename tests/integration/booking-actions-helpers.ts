import { expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { TeamRole } from "@prisma/client";
import type { ActionResult } from "@/app/actions/makerspace";
import type { StaffActor } from "@/lib/bookings/actor";
import { prisma } from "@/lib/db";
import { NOW, setupMakerspace } from "./bookings-helpers";

/** Database-backed permissions still run: these staff really have team membership and MFA. */
export async function setupActionMakerspace(...args: Parameters<typeof setupMakerspace>) {
  const fixture = await setupMakerspace(...args);
  const staffByRole = new Map<TeamRole, StaffActor>([["OWNER", fixture.owner]]);
  await prisma.user.update({ where: { id: fixture.owner.userId }, data: { mfaEnabledAt: NOW } });
  return { ...fixture, scope: { makerspaceSlug: fixture.makerspace.slug },
    async staff(role: TeamRole) {
      const existing = staffByRole.get(role);
      if (existing) return existing;
      const actor = await fixture.staff(role);
      await prisma.user.update({ where: { id: actor.userId }, data: { mfaEnabledAt: NOW } });
      staffByRole.set(role, actor);
      return actor;
    },
  };
}

export type ActionFixture = Awaited<ReturnType<typeof setupActionMakerspace>>;
export type Identity = { userId: string | null; ip: string };

export function resetActionRequest(identity: Identity) {
  identity.userId = null;
  identity.ip = randomUUID();
  vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "x-forwarded-for");
  // Only Date is faked: Prisma and real rate limits retain their normal asynchronous timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
}

export function dataOf<T>(result: ActionResult<T>): T {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok || result.data === undefined) throw new Error(JSON.stringify(result));
  return result.data;
}

export async function auditFor(makerspaceId: string, targetId: string, area: string) {
  return prisma.auditEvent.findMany({ where: { makerspaceId, targetId, action: "SETTINGS_CHANGED",
    metadata: { path: ["area"], equals: area } } });
}
