import { apiHandler, apiJson } from "@/lib/api/handler";
import { spaceAvailability } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  return apiHandler(request, "read", async (context) => apiJson(await spaceAvailability(context, spaceId, new URL(request.url).searchParams)));
}
