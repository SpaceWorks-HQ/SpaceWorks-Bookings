import { apiHandler, apiJson, jsonBody } from "@/lib/api/handler";
import { cancelApiBooking } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

/** Cancel for the customer: the booking's frozen cancellation policy applies and refunds follow. */
export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return apiHandler(request, "write", async (context) => apiJson({ data: await cancelApiBooking(context, reference, await jsonBody(request)) }));
}
