import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { workbook } from "@/lib/finance/xlsx";
import { auditedCsvResponse, type AuditedExport } from "./stream";

/**
 * One export in either format: CSV (streamed, through auditedCsvResponse) or Excel (.xlsx, built in memory and
 * audited before and after, like the CSV). `format` comes from the `format` query parameter.
 */
export async function auditedTableResponse(input: AuditedExport & { rows: unknown[][] }, format: string | null): Promise<Response> {
  if (format !== "xlsx") return auditedCsvResponse(input);
  const base = { action: input.audit.action, actorUserId: input.audit.actorUserId, makerspaceId: input.audit.makerspaceId, targetType: "Makerspace", targetId: input.audit.makerspaceId ?? undefined };
  try {
    await recordAuditEvent({ ...base, metadata: { report: input.audit.report, stage: "started", format: "xlsx", ...input.audit.filters } });
  } catch {
    return new Response("The export couldn't be recorded, so it was not sent. Try again shortly.", { status: 503, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
  const body = workbook(input.audit.report, input.header, input.rows as Array<Array<string | number | null>>);
  await recordAuditEvent({ ...base, metadata: { report: input.audit.report, rows: input.rows.length, complete: true, format: "xlsx", ...input.audit.filters } }).catch(() => console.error("[reports] export audit failed"));
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${input.filename.replace(/\.csv$/, ".xlsx").replace(/[^a-z0-9._-]/gi, "-")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
