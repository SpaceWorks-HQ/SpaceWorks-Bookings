import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { makerspaceSummary } from "@/lib/bookings/staffView";
import { repairAccess } from "@/lib/repairs/access";
import { payoutState } from "@/lib/repairs/rules";

const MONEY_KEYS = new Set(["amountMinor", "askedMinor", "amountAskedMinor"]);

/** One issue with its photos and timeline; requests and the directory for managers; amounts only where allowed. */
export async function loadIssue({ params }: { params: Promise<{ makerspaceSlug: string; issueId: string }> }) {
  const { makerspaceSlug, issueId } = await params;
  const access = await repairAccess(makerspaceSlug);
  const makerspaceId = access.makerspace.id;
  const issue = await prisma.spaceIssue.findFirst({
    where: { id: issueId, makerspaceId, ...(access.flags.viewAll ? {} : { requests: { some: { technicianId: access.technicianId ?? "-" } } }) },
    include: {
      space: { select: { id: true, name: true } }, technician: { select: { id: true, name: true, kind: true } },
      photos: { orderBy: { createdAt: "asc" }, select: { id: true, url: true, addedBy: true } },
      events: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, actorKind: true, actorUserId: true, technicianId: true, data: true, createdAt: true } },
      requests: { orderBy: { sentAt: "asc" }, select: { id: true, technicianId: true, status: true, channels: true, sentAt: true, answeredAt: true } },
      payouts: { orderBy: { paidAt: "asc" }, select: { id: true, amountMinor: true, method: true, reference: true, paidAt: true } },
    },
  });
  if (!issue) notFound();
  const mine = issue.technicianId !== null && issue.technicianId === access.technicianId;
  const money = access.flags.pay;
  const userIds = [...new Set(issue.events.flatMap((event) => (event.actorUserId ? [event.actorUserId] : [])))];
  const technicianIds = [...new Set([...issue.events.flatMap((event) => (event.technicianId ? [event.technicianId] : [])), ...issue.requests.map((request) => request.technicianId)])];
  const [users, technicians, directory] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds }, teamMembers: { some: { makerspaceId } } }, select: { id: true, name: true, email: true } }),
    prisma.technician.findMany({ where: { makerspaceId, id: { in: technicianIds } }, select: { id: true, name: true } }),
    access.flags.manage ? prisma.technician.findMany({ where: { makerspaceId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, skills: true, email: true, whatsapp: true, telegramChatId: true } }) : [],
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name || user.email || "Team member"]));
  const technicianName = new Map(technicians.map((row) => [row.id, row.name]));
  const paidMinor = issue.payouts.reduce((sum, payout) => sum + payout.amountMinor, 0);
  const myRequest = access.technicianId ? issue.requests.find((request) => request.technicianId === access.technicianId) ?? null : null;
  return {
    makerspace: await makerspaceSummary(makerspaceId),
    flags: access.flags,
    mine, myRequest: myRequest?.status ?? null,
    issue: {
      id: issue.id, reference: issue.reference, title: issue.title, description: issue.description, severity: issue.severity, status: issue.status,
      space: issue.space, technician: issue.technician, reporterKind: issue.reporterKind, createdAt: issue.createdAt.toISOString(), outOfService: Boolean(issue.blackoutId),
      fixRemarks: issue.fixRemarks, partsUsed: issue.partsUsed, fixedAt: issue.fixedAt?.toISOString() ?? null, currency: issue.currency,
      amountAskedMinor: money || mine ? issue.amountAskedMinor : null,
      approvedMinor: money ? issue.approvedMinor : null, approvalNote: money ? issue.approvalNote : "",
      paidMinor: money ? paidMinor : null,
      payout: money || mine ? payoutState({ amountAskedMinor: issue.amountAskedMinor, approvedMinor: issue.approvedMinor, paidMinor }) : null,
    },
    photos: issue.photos,
    payouts: money ? issue.payouts.map((payout) => ({ ...payout, paidAt: payout.paidAt.toISOString() })) : [],
    requests: access.flags.manage ? issue.requests.map((request) => ({ ...request, technician: technicianName.get(request.technicianId) ?? "Technician", sentAt: request.sentAt.toISOString(), answeredAt: request.answeredAt?.toISOString() ?? null })) : [],
    directory: directory.map((row) => ({ id: row.id, name: row.name, kind: row.kind, skills: row.skills, channels: [row.email ? "Email" : null, row.whatsapp ? "WhatsApp" : null, row.telegramChatId ? "Telegram" : null].filter(Boolean) as string[] })),
    timeline: issue.events
      .filter((event) => (money || !["approved", "paid"].includes(event.kind)) && (access.flags.viewAll || event.technicianId === access.technicianId || ["reported", "fixed", "closed", "reopened", "photo"].includes(event.kind)))
      .map((event) => ({
        id: event.id, kind: event.kind, createdAt: event.createdAt.toISOString(),
        who: event.actorKind === "CUSTOMER" ? "The customer" : event.actorKind === "SYSTEM" ? "Space Works" : event.actorKind === "TECHNICIAN" ? technicianName.get(event.technicianId ?? "") ?? "The technician" : userName.get(event.actorUserId ?? "") ?? "Team member",
        technician: event.technicianId ? technicianName.get(event.technicianId) ?? null : null,
        data: Object.fromEntries(Object.entries((event.data ?? {}) as Record<string, unknown>).filter(([key, value]) => (money || !MONEY_KEYS.has(key)) && (typeof value === "string" || typeof value === "number" || Array.isArray(value)))),
      })),
  };
}
