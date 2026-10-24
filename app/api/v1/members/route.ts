import { apiError, apiHandler, apiJson, jsonBody } from "@/lib/api/handler";
import { removeApiMember, upsertApiMember } from "@/lib/api/bookings";

export const dynamic = "force-dynamic";

/** Add or update a member-rate entry by email. */
export function PUT(request: Request) {
  return apiHandler(request, "write", async (context) => apiJson({ data: await upsertApiMember(context, await jsonBody(request)) }));
}

/** Remove a member-rate entry: `DELETE /api/v1/members?email=…`. */
export function DELETE(request: Request) {
  return apiHandler(request, "write", async (context) => {
    const email = new URL(request.url).searchParams.get("email");
    if (!email) return apiError(422, "INVALID_INPUT", "Pass the member's email as ?email=.");
    await removeApiMember(context, email);
    return new Response(null, { status: 204 });
  });
}
