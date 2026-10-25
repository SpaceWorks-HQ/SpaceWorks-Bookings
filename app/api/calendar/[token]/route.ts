import { renderCalendarFeed } from "@/lib/ics/feeds";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return new Response("Not found", { status: 404, headers });
  const calendar = await renderCalendarFeed(token);
  return calendar ? new Response(calendar, { headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8" } }) : new Response("Not found", { status: 404, headers });
}
