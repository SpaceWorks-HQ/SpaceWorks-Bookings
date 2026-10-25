import { apiHandler, apiJson, jsonBody } from "@/lib/api/handler";
import { createBooking, listBookings } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return apiHandler(request, "read", async (context) => apiJson(await listBookings(context, new URL(request.url).searchParams)));
}

export function POST(request: Request) {
  return apiHandler(request, "write", async (context) => apiJson({ data: await createBooking(context, await jsonBody(request)) }, 201));
}
