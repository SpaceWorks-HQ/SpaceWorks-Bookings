import { apiHandler, apiJson } from "@/lib/api/handler";
import { getBooking } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return apiHandler(request, "read", async (context) => apiJson({ data: await getBooking(context, reference) }));
}
