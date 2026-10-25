import type { IssueStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makerspaceSummary, pageNumber } from "@/lib/bookings/staffView";
import { repairAccess } from "@/lib/repairs/access";
import { payoutState } from "@/lib/repairs/rules";

const PAGE = 50;
const STATUSES: IssueStatus[] = ["REPORTED", "ASSIGNED", "FIXED", "CLOSED"];

/** Issues with the makerspace's spaces: all of them for staff, only their own requests for a technician. */
export async function loadIssues({ params, searchParams }: { params: Promise<{ makerspaceSlug: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const { makerspaceSlug } = await params;
  const query = await searchParams;
  const access = await repairAccess(makerspaceSlug);
  const makerspaceId = access.makerspace.id;
  const status = STATUSES.find((value) => value === query.status);
  const where: Prisma.SpaceIssueWhereInput = {
    makerspaceId, ...(status ? { status } : { status: { not: "CLOSED" } }),
    ...(access.flags.viewAll ? {} : { requests: { some: { technicianId: access.technicianId ?? "-" } } }),
  };
  const page = pageNumber(query.page);
  const [total, rows, spaces] = await Promise.all([
    prisma.spaceIssue.count({ where }),
    prisma.spaceIssue.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE, take: PAGE,
      select: {
        id: true, reference: true, title: true, severity: true, status: true, createdAt: true, technicianId: true, amountAskedMinor: true, approvedMinor: true, currency: true,
        space: { select: { name: true } }, technician: { select: { name: true } }, payouts: { select: { amountMinor: true } },
        requests: { where: { technicianId: access.technicianId ?? "-" }, select: { status: true } },
      },
    }),
    access.flags.report ? prisma.space.findMany({ where: { makerspaceId, archivedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  return {
    makerspace: await makerspaceSummary(makerspaceId),
    flags: access.flags,
    status: status ?? "",
    page, pages: Math.max(1, Math.ceil(total / PAGE)),
    spaces,
    issues: rows.map((row) => {
      const mine = row.technicianId !== null && row.technicianId === access.technicianId;
      const paidMinor = row.payouts.reduce((sum, payout) => sum + payout.amountMinor, 0);
      return {
        id: row.id, reference: row.reference, title: row.title, severity: row.severity, status: row.status, createdAt: row.createdAt.toISOString(),
        space: row.space.name, technician: row.technician?.name ?? null, myRequest: row.requests[0]?.status ?? null,
        // Money only for finance, or for the technician on their own repair.
        payout: access.flags.pay || mine ? payoutState({ amountAskedMinor: row.amountAskedMinor, approvedMinor: row.approvedMinor, paidMinor }) : null,
      };
    }),
  };
}
