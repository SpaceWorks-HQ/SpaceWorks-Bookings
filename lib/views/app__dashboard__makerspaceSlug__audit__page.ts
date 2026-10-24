import { prisma } from "@/lib/db";
import { requireMakerspaceCapability } from "@/lib/permissions";
import { makerspaceSummary, pageNumber } from "@/lib/bookings/staffView";

const PAGE = 50;

/** The makerspace's audit log (`audit.view`), newest first, filtered by action. Metadata never holds secrets. */
export async function loadAuditLog({ params, searchParams }: { params: Promise<{ makerspaceSlug: string }>; searchParams: Promise<{ action?: string; page?: string }> }) {
  const { makerspaceSlug } = await params;
  const query = await searchParams;
  const { makerspace } = await requireMakerspaceCapability(makerspaceSlug, "audit.view");
  const action = query.action && /^[A-Z_]{2,64}$/.test(query.action) ? query.action : undefined;
  const where = { makerspaceId: makerspace.id, ...(action ? { action } : {}) };
  const page = pageNumber(query.page);
  const [total, events, actions] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE, take: PAGE, select: { id: true, action: true, targetType: true, targetId: true, metadata: true, createdAt: true, actor: { select: { name: true, email: true } } } }),
    prisma.auditEvent.findMany({ where: { makerspaceId: makerspace.id }, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    makerspace: await makerspaceSummary(makerspace.id),
    action: action ?? "",
    actions: actions.map((row) => row.action),
    page, pages: Math.max(1, Math.ceil(total / PAGE)),
    events: events.map((event) => ({
      id: event.id, action: event.action, target: event.targetType ? `${event.targetType}${event.targetId ? ` ${event.targetId.slice(-8)}` : ""}` : "",
      actor: event.actor ? event.actor.name || event.actor.email : "System", createdAt: event.createdAt.toISOString(),
      details: event.metadata && typeof event.metadata === "object" ? Object.entries(event.metadata as Record<string, unknown>).filter(([, value]) => value !== null && typeof value !== "object").map(([key, value]) => `${key}: ${String(value)}`).join(" · ").slice(0, 240) : "",
    })),
  };
}
