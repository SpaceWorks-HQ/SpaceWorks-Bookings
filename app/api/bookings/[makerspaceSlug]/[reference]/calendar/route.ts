import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { canReadBooking } from "@/lib/ics/access";
import { bookingInvite } from "@/lib/ics/booking";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ makerspaceSlug: string; reference: string }> }) {
  const { makerspaceSlug, reference } = await params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  const missing = () => new Response("Not found", { status: 404, headers });
  const makerspace = await prisma.makerspace.findUnique({ where: { slug: makerspaceSlug }, select: { id: true, name: true, contactEmail: true, addressLine: true, city: true } });
  if (!makerspace) return missing();
  const booking = await prisma.booking.findFirst({ where: { makerspaceId: makerspace.id, reference }, include: { occurrences: true, space: { select: { name: true } } } });
  const session = await auth();
  if (!booking || !canReadBooking(booking, { makerspaceId: makerspace.id, reference, userId: session?.user?.id, token: new URL(request.url).searchParams.get("t") })) return missing();
  const cancelled = ["CANCELLED", "DECLINED", "EXPIRED"].includes(booking.status);
  const rows = cancelled ? booking.occurrences : booking.occurrences.filter((row) => row.status !== "CANCELLED");
  const calendar = bookingInvite({ booking, spaceName: booking.space.name, makerspace: { ...makerspace, address: [makerspace.addressLine, makerspace.city].filter(Boolean).join(", ") || null }, now: new Date() }, rows, cancelled ? "CANCEL" : "REQUEST");
  return new Response(calendar, { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${booking.reference.replace(/[^A-Z0-9-]/g, "")}.ics"` } });
}
