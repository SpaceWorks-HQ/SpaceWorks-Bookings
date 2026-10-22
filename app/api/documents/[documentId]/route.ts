import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, makerspaceAllows } from "@/lib/permissionRoles";
import { hasAuthenticator } from "@/lib/permissions";
import { checkRateLimitById } from "@/lib/rateLimit";
import type { DocumentSnapshot } from "@/lib/payments/documents";
import { renderDocumentPdf } from "@/lib/payments/pdf";

export const dynamic = "force-dynamic";

function refuse(status: number, message: string) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * A receipt, tax invoice, bill of supply or credit note as PDF, rendered from its frozen snapshot.
 * Open to the makerspace's team with payments.view and to the customer it was issued to (verified email).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return refuse(401, "Sign in to download documents.");
  if (!(await checkRateLimitById("documentView", `user:${userId}`))) return refuse(429, "Too many downloads. Try again later.");
  const { documentId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(documentId)) return refuse(404, "Not found.");
  const document = await prisma.taxDocument.findUnique({ where: { id: documentId }, select: { makerspaceId: true, number: true, snapshot: true, payment: { select: { customerEmail: true } } } });
  if (!document?.payment) return refuse(404, "Not found.");

  let allowed = false;
  const membership = await prisma.teamMember.findUnique({ where: { userId_makerspaceId: { userId, makerspaceId: document.makerspaceId } } });
  // Team access needs the staff authenticator; a customer downloading their own receipt does not.
  if (membership && (await hasAuthenticator(userId))) {
    const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { id: document.makerspaceId }, select: { status: true } });
    allowed = makerspaceAllows(makerspace.status, "payments.view") && can(membership.role, "payments.view");
  }
  if (!allowed) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
    allowed = Boolean(user?.email && user.emailVerified && user.email.toLowerCase() === document.payment.customerEmail);
  }
  if (!allowed) return refuse(404, "Not found.");

  const pdf = await renderDocumentPdf(document.snapshot as unknown as DocumentSnapshot);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${document.number.replace(/[^A-Za-z0-9-]/g, "")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
