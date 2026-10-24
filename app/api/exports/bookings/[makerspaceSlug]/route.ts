import { prisma } from "@/lib/db";
import { auditedCsvResponse } from "@/lib/reports/exports/stream";
import { exportAccess, majorUnits } from "@/lib/reports/exports/staffAccess";
import { resolvePeriod } from "@/lib/reports/period";
import { can } from "@/lib/permissionRoles";
import { getMembership } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Bookings made in the report period, one row per booking (contact details only with `bookings.contact`). */
export async function GET(request: Request, { params }: { params: Promise<{ makerspaceSlug: string }> }) {
  const { makerspaceSlug } = await params;
  const access = await exportAccess(makerspaceSlug, "reports.view");
  if (!access.ok) return new Response(null, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const period = resolvePeriod(query, access.makerspace, new Date());
  const contact = can((await getMembership(access.userId, access.makerspace.id))?.role, "bookings.contact");
  const bookings = await prisma.booking.findMany({
    where: { makerspaceId: access.makerspace.id, submittedAt: { not: null }, createdAt: { gte: period.from, lt: period.to } }, orderBy: { createdAt: "asc" },
    select: { reference: true, status: true, source: true, createdAt: true, contactName: true, contactEmail: true, attendees: true, quantity: true, rateKind: true, chargeMode: true, currency: true, totalMinor: true, chargeMinor: true, paidMinor: true, refundedMinor: true, cancelKind: true, space: { select: { name: true } }, occurrences: { orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } } },
  });
  return auditedCsvResponse({
    header: ["Reference", "Created", "Space", "First start", "Status", "Source", ...(contact ? ["Customer", "Email"] : []), "Attendees", "Quantity", "Rate", "Charge mode", "Currency", "Total", "Charge", "Paid", "Refunded", "Cancelled by"],
    rows: bookings.map((row) => [row.reference, row.createdAt.toISOString(), row.space.name, row.occurrences[0]?.startsAt.toISOString() ?? "", row.status, row.source, ...(contact ? [row.contactName, row.contactEmail] : []),
      row.attendees, row.quantity, row.rateKind, row.chargeMode, row.currency, majorUnits(row.totalMinor, row.currency), majorUnits(row.chargeMinor, row.currency), majorUnits(row.paidMinor, row.currency), majorUnits(row.refundedMinor, row.currency), row.cancelKind ?? ""]),
    filename: `bookings-${access.makerspace.slug}-${period.from.toISOString().slice(0, 10)}.csv`,
    audit: { action: "REPORT_EXPORTED", actorUserId: access.userId, makerspaceId: access.makerspace.id, report: "bookings", filters: { period: period.preset, from: period.from.toISOString(), to: period.to.toISOString(), contact } },
  });
}
