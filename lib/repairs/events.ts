import type { Prisma } from "@prisma/client";
import type { CustomerActor, StaffActor, SystemActor } from "@/lib/bookings/actor";
import type { Tx } from "@/lib/bookings/db";

/** An external technician acting through their request link (no account). */
export type LinkActor = { kind: "LINK"; technicianId: string };
export type RepairActor = StaffActor | CustomerActor | SystemActor | LinkActor;

const ACTOR_KIND = { STAFF: "STAFF", CUSTOMER: "CUSTOMER", SYSTEM: "SYSTEM", LINK: "TECHNICIAN" } as const;

/** Append one row to the issue's timeline, in the change's own transaction. Data carries ids and amounts only. */
export async function recordIssueEvent(tx: Tx, input: { makerspaceId: string; issueId: string; kind: string; actor: RepairActor; technicianId?: string | null; data?: Prisma.InputJsonObject }) {
  const actorUserId = input.actor.kind === "STAFF" || input.actor.kind === "CUSTOMER" ? input.actor.userId : null;
  await tx.issueEvent.create({
    data: {
      makerspaceId: input.makerspaceId, issueId: input.issueId, kind: input.kind, actorKind: ACTOR_KIND[input.actor.kind], actorUserId,
      technicianId: input.technicianId ?? (input.actor.kind === "LINK" ? input.actor.technicianId : null), data: input.data ?? {},
    },
  });
}

/** Lock one issue of a makerspace (FOR UPDATE) and read it; another makerspace's issue is not found. */
export async function lockIssue(tx: Tx, makerspaceId: string, issueId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "SpaceIssue" WHERE "id" = ${issueId} AND "makerspaceId" = ${makerspaceId} FOR UPDATE`;
  return rows.length ? tx.spaceIssue.findUniqueOrThrow({ where: { id: issueId } }) : null;
}
