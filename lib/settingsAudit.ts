import type { Prisma } from "@prisma/client";

/**
 * Every settings write (booking rules, spaces, rates, hours, blackouts, add-ons, refund tiers, members…) goes
 * through `saveSetting` in the same transaction as the change. It writes one AuditEvent `SETTINGS_CHANGED` with
 * the area and a field-by-field diff. Secret-looking fields and the caller's `redact` list are never stored; the
 * diff only says they changed. No row is written when nothing changed.
 */

export const SETTINGS_AUDIT_ACTION = "SETTINGS_CHANGED";

const SECRET_FIELD = /secret|password|token|apikey|api_key|privatekey|encrypted|hash/i;
const REDACTED = "[redacted]";

type Snapshot = Record<string, unknown> | null | undefined;
export type FieldChange = { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null };

function normalise(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** The fields that differ between two snapshots, with redaction applied. */
export function settingsDiff(before: Snapshot, after: Snapshot, redact: readonly string[] = []): Record<string, FieldChange> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Record<string, FieldChange> = {};
  for (const key of [...keys].sort()) {
    if (key === "updatedAt" || key === "createdAt") continue;
    const from = normalise(before?.[key]);
    const to = normalise(after?.[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    const hidden = SECRET_FIELD.test(key) || redact.includes(key);
    changes[key] = hidden ? { from: from === null ? null : REDACTED, to: to === null ? null : REDACTED } : { from, to };
  }
  return changes;
}

export type SaveSettingInput = {
  /** What was changed, e.g. "booking-rules", "space", "space-rates", "opening-hours", "blackout", "member". */
  area: string;
  makerspaceId: string;
  targetType: string;
  targetId: string;
  /** null when created. */
  before: Snapshot;
  /** null when deleted. */
  after: Snapshot;
  actorUserId: string | null;
  /** Personal fields to keep out of the audit trail (e.g. a member's email). */
  redact?: readonly string[];
};

export async function saveSetting(tx: Prisma.TransactionClient, input: SaveSettingInput) {
  const changes = settingsDiff(input.before, input.after, input.redact);
  if (Object.keys(changes).length === 0) return null;
  const operation = input.before == null ? "created" : input.after == null ? "deleted" : "updated";
  return tx.auditEvent.create({
    data: {
      action: SETTINGS_AUDIT_ACTION,
      actorUserId: input.actorUserId,
      makerspaceId: input.makerspaceId,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: { area: input.area, operation, changes } as Prisma.InputJsonValue,
    },
  });
}
