import { recordThrottledAuditEvent } from "@/lib/audit";
import { authorizeCardAccess } from "@/lib/cards/access";
import { loadCardForRender } from "@/lib/cards/data";
import { renderMemberCard } from "@/lib/cards/render";
import { download, jsonError, notFoundResponse, slugForFile } from "@/lib/downloads";
import { checkRateLimitById } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * One member card as a PDF (front and back pages) or a 300 dpi PNG of one side:
 * GET /api/cards/{cardId}?format=pdf|png&side=front|back. Managers who can see the member, and the
 * member themself, may download it; anyone else gets 404. Every download is audited.
 */
export async function GET(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "png" ? "png" : "pdf";
  const side = url.searchParams.get("side") === "back" ? "back" : "front";

  const viewer = await authorizeCardAccess(cardId);
  if (!viewer) return notFoundResponse();
  if (!(await checkRateLimitById("cardRender", `user:${viewer.userId}`))) return jsonError(429, "Too many card downloads. Try again later.");
  const loaded = await loadCardForRender(cardId);
  if (!loaded) return notFoundResponse();
  // A replaced or revoked card is history: only the team may still fetch it.
  if (loaded.card.revokedAt && viewer.as !== "team") return notFoundResponse();

  const body = await renderMemberCard(loaded.input, loaded.holder, format, { side, title: `${loaded.holder.displayName} membership card` });
  await recordThrottledAuditEvent({
    action: "CARD_DOWNLOADED",
    actorUserId: viewer.userId,
    organisationId: loaded.card.organisationId,
    targetType: "MemberCard",
    targetId: loaded.card.id,
    metadata: { format, side, by: viewer.as },
    windowMs: 10 * 60_000,
  });
  const name = `${loaded.card.cardNumber}-${slugForFile(loaded.holder.displayName, "member")}${format === "png" && side === "back" ? "-back" : ""}.${format}`;
  return download(body, format === "png" ? "image/png" : "application/pdf", name);
}
