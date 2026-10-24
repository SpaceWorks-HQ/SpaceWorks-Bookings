import { openApiDocument } from "@/lib/api/openapi";

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(openApiDocument(), null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
