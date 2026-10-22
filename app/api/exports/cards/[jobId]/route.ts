import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { download, notFoundResponse } from "@/lib/downloads";
import { can, organisationAllows } from "@/lib/permissionRoles";
import { hasAuthenticator } from "@/lib/permissions";
import { downloadPrivateExport } from "@/lib/storage/private";

export const dynamic = "force-dynamic";

/**
 * A finished bulk card export. Only the person who asked for it may download it, while they still
 * manage cards in that organisation with the same unit scope; everyone else (and expired files) gets 404.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return notFoundResponse();
  const job = await prisma.cardExportJob.findUnique({ where: { id: jobId }, include: { organisation: { select: { slug: true, status: true } } } });
  if (!job || job.requestedById !== userId || job.status !== "DONE" || !job.storageKey || (job.expiresAt && job.expiresAt <= new Date())) return notFoundResponse();
  const membership = await prisma.teamMember.findUnique({ where: { userId_organisationId: { userId, organisationId: job.organisationId } } });
  if (!membership || !can(membership.role, "cards.manage") || !organisationAllows(job.organisation.status, "cards.manage") || !(await hasAuthenticator(userId))) return notFoundResponse();
  // The file was built for the requester's unit scope at the time; a changed scope can't fetch it.
  const filter = (job.filter ?? {}) as Record<string, unknown>;
  if ((typeof filter.scopeUnitId === "string" ? filter.scopeUnitId : null) !== membership.unitId) return notFoundResponse();

  const file = await downloadPrivateExport(job.storageKey);
  if (!file) return notFoundResponse();
  await recordAuditEvent({ action: "CARD_EXPORT_DOWNLOADED", actorUserId: userId, organisationId: job.organisationId, targetType: "CardExportJob", targetId: job.id, metadata: { cards: job.cardCount ?? 0, format: job.format } });
  const extension = job.format === "zip" ? "zip" : "pdf";
  return download(file.body, file.contentType, `${job.organisation.slug}-cards-${job.createdAt.toISOString().slice(0, 10)}.${extension}`);
}
