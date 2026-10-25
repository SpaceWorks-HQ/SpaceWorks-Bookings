import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { findRequestByToken } from "@/lib/repairs/requests";
import { payoutState } from "@/lib/repairs/rules";

/**
 * An external technician's request link: the one issue, nothing else. An unknown, expired, closed or someone else's
 * link is not found, the same answer every time.
 */
export async function loadRepairLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await findRequestByToken(token);
  if (!request || request.expiresAt <= new Date() || !["SENT", "ACCEPTED"].includes(request.status)) notFound();
  const issue = await prisma.spaceIssue.findFirst({
    where: { id: request.issueId, makerspaceId: request.makerspaceId },
    include: { space: { select: { name: true } }, makerspace: { select: { name: true, currency: true } }, photos: { orderBy: { createdAt: "asc" }, select: { id: true, url: true } }, payouts: { select: { amountMinor: true } } },
  });
  if (!issue || (request.status === "ACCEPTED" && issue.technicianId !== request.technicianId)) notFound();
  const technician = await prisma.technician.findUniqueOrThrow({ where: { id: request.technicianId }, select: { name: true } });
  const paidMinor = issue.payouts.reduce((sum, payout) => sum + payout.amountMinor, 0);
  return {
    token, status: request.status, technician: technician.name, makerspace: issue.makerspace.name,
    issue: {
      reference: issue.reference, title: issue.title, description: issue.description, severity: issue.severity, status: issue.status, space: issue.space.name,
      fixRemarks: issue.fixRemarks, partsUsed: issue.partsUsed, amountAskedMinor: issue.amountAskedMinor, currency: issue.currency, approved: issue.approvedMinor !== null,
      payout: request.status === "ACCEPTED" ? payoutState({ amountAskedMinor: issue.amountAskedMinor, approvedMinor: issue.approvedMinor, paidMinor }) : null,
    },
    photos: issue.photos,
  };
}
