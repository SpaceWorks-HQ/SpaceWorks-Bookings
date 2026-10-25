import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getMembership, hasAuthenticator } from "@/lib/permissions";
import { can } from "@/lib/permissionRoles";
import { canReadBooking } from "@/lib/ics/access";
import { loadStatement, renderStatementPdf } from "@/lib/bookings/money/statement";

export const dynamic = "force-dynamic";

/** The booking statement PDF: for the customer (owner or manage token) and for staff who see payments. */
export async function GET(request: Request, { params }: { params: Promise<{ makerspaceSlug: string; reference: string }> }) {
  const { makerspaceSlug, reference } = await params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  const missing = () => new Response("Not found", { status: 404, headers });
  const makerspace = await prisma.makerspace.findUnique({ where: { slug: makerspaceSlug }, select: { id: true } });
  if (!makerspace) return missing();
  const booking = await prisma.booking.findFirst({ where: { makerspaceId: makerspace.id, reference }, select: { id: true, makerspaceId: true, reference: true, customerUserId: true, manageTokenHash: true } });
  if (!booking) return missing();
  const userId = (await auth())?.user?.id ?? null;
  const customer = canReadBooking(booking, { makerspaceId: makerspace.id, reference, userId, token: new URL(request.url).searchParams.get("t") });
  const staff = !customer && userId ? can((await getMembership(userId, makerspace.id))?.role, "payments.view") && (await hasAuthenticator(userId)) : false;
  if (!customer && !staff) return missing();
  const statement = await loadStatement(makerspace.id, booking.id);
  if (!statement) return missing();
  const bytes = await renderStatementPdf(statement);
  return new Response(Buffer.from(bytes), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${booking.reference.replace(/[^A-Z0-9-]/g, "")}-statement.pdf"` } });
}
