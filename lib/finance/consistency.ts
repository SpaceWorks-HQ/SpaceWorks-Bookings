import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";

/**
 * The ledger against its sources: every PAID payment, PROCESSED refund and repair payout has exactly one entry with
 * its amount, and no entry points at a source that is gone or no longer settled. Run hourly and in tests; each
 * problem is audited for the makerspace (money is never "fixed" automatically).
 */
export async function checkFinanceLedger(makerspaceId?: string) {
  const scope = makerspaceId ?? null;
  const rows = await prisma.$queryRaw<Array<{ makerspaceId: string; sourceType: string; sourceId: string; problem: string }>>`
    WITH sources AS (
      SELECT p."makerspaceId", 'PAYMENT' AS "sourceType", p."id" AS "sourceId", COALESCE(p."capturedMinor", p."amountMinor") AS amount
        FROM "Payment" p WHERE p."status" = 'PAID' AND COALESCE(p."capturedMinor", p."amountMinor") > 0
      UNION ALL
      SELECT r."makerspaceId", 'REFUND', r."id", r."amountMinor" FROM "Refund" r WHERE r."status" = 'PROCESSED' AND r."amountMinor" > 0
      UNION ALL
      SELECT o."makerspaceId", 'REPAIR_PAYOUT', o."id", o."amountMinor" FROM "RepairPayout" o
    )
    SELECT COALESCE(s."makerspaceId", e."makerspaceId") AS "makerspaceId", COALESCE(s."sourceType", e."sourceType") AS "sourceType",
      COALESCE(s."sourceId", e."sourceId") AS "sourceId",
      CASE WHEN e."id" IS NULL THEN 'missing' WHEN s."sourceId" IS NULL THEN 'orphan' ELSE 'amount' END AS problem
    FROM sources s
    FULL JOIN (SELECT * FROM "FinanceEntry" WHERE "sourceType" IN ('PAYMENT', 'REFUND', 'REPAIR_PAYOUT')) e ON e."sourceType" = s."sourceType" AND e."sourceId" = s."sourceId"
    WHERE (${scope}::text IS NULL OR COALESCE(s."makerspaceId", e."makerspaceId") = ${scope})
      AND (e."id" IS NULL OR s."sourceId" IS NULL OR e."amountMinor" <> s.amount)
    LIMIT 200`;
  return rows;
}

export async function auditFinanceLedger() {
  const problems = await checkFinanceLedger();
  for (const row of problems) {
    console.error("[finance] the ledger disagrees with its source");
    await recordAuditEvent({ action: "FINANCE_LEDGER_MISMATCH", actorUserId: null, makerspaceId: row.makerspaceId, targetType: row.sourceType, targetId: row.sourceId, metadata: { problem: row.problem } });
  }
  return problems.length;
}
