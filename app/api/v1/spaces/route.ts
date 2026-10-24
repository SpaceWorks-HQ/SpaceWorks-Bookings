import { apiHandler, apiJson } from "@/lib/api/handler";
import { listSpaces } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return apiHandler(request, "read", async (context) => apiJson({ data: await listSpaces(context) }));
}
