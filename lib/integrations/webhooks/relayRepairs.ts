import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WebhookEvent } from "./events";

/**
 * Webhooks from the issue timeline (`issue.reported`, `issue.resolved`, `repair.paid`) and the finance ledger
 * (`finance.entry_posted`), relayed like the booking timeline (relay.ts): an overlapping scan behind a cursor, one
 * delivery per endpoint and source row. Payloads carry ids, statuses, amounts and categories, never names or notes.
 */

const OVERLAP_MS = 5 * 60_000;
const SETTLE_MS = 10_000;
const BATCH = 500;
const ISSUE_KINDS: Record<string, WebhookEvent> = { reported: "issue.reported", closed: "issue.resolved", paid: "repair.paid" };

type Source = { id: string; createdAt: Date; makerspaceId: string };

async function relay<T extends Source>(cursorId: string, now: Date, load: (from: Date, until: Date) => Promise<T[]>, describe: (row: T) => Promise<{ type: WebhookEvent; data: Record<string, unknown>; slug: string } | null>) {
  const cursor = await prisma.webhookRelayCursor.findUnique({ where: { id: cursorId } });
  const until = new Date(now.getTime() - SETTLE_MS);
  const rows = await load(cursor ? new Date(cursor.createdAt.getTime() - OVERLAP_MS) : new Date(now.getTime() - OVERLAP_MS), until);
  let queued = 0;
  for (const row of rows) {
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { makerspaceId: row.makerspaceId, isActive: true, createdAt: { lte: row.createdAt } }, select: { id: true, events: true } });
    if (endpoints.length === 0) continue;
    const event = await describe(row);
    if (!event) continue;
    const wanted = endpoints.filter((endpoint) => endpoint.events.includes(event.type));
    if (wanted.length === 0) continue;
    const payload = { id: row.id, type: event.type, createdAt: row.createdAt.toISOString(), makerspace: event.slug, data: event.data };
    const created = await prisma.webhookDelivery.createMany({
      data: wanted.map((endpoint) => ({ makerspaceId: row.makerspaceId, endpointId: endpoint.id, event: event.type, eventId: row.id, payload: payload as Prisma.InputJsonValue, nextAttemptAt: now })),
      skipDuplicates: true,
    });
    queued += created.count;
  }
  const last = rows.at(-1);
  if (last) await prisma.webhookRelayCursor.upsert({ where: { id: cursorId }, create: { id: cursorId, createdAt: last.createdAt, eventId: last.id }, update: { createdAt: last.createdAt, eventId: last.id } });
  else if (!cursor) await prisma.webhookRelayCursor.create({ data: { id: cursorId, createdAt: until, eventId: "" } }).catch(() => undefined);
  return queued;
}

const withEndpoints = { makerspace: { webhookEndpoints: { some: { isActive: true } } } };

export async function relayRepairWebhooks(now = new Date()) {
  const issues = await relay("issue-events", now,
    (from, until) => prisma.issueEvent.findMany({ where: { createdAt: { gte: from, lt: until }, kind: { in: Object.keys(ISSUE_KINDS) }, issue: withEndpoints }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH }),
    async (row) => {
      const issue = await prisma.spaceIssue.findUnique({ where: { id: row.issueId }, select: { id: true, reference: true, status: true, severity: true, spaceId: true, currency: true, makerspace: { select: { slug: true } }, space: { select: { slug: true } } } });
      if (!issue) return null;
      const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
      return {
        type: ISSUE_KINDS[row.kind], slug: issue.makerspace.slug,
        data: { issue: { id: issue.id, reference: issue.reference, status: issue.status, severity: issue.severity, space: { id: issue.spaceId, slug: issue.space.slug } }, ...(row.kind === "paid" ? { payoutId: data.payoutId, amountMinor: data.amountMinor, currency: issue.currency } : {}) },
      };
    });
  const entries = await relay("finance-entries", now,
    (from, until) => prisma.financeEntry.findMany({ where: { createdAt: { gte: from, lt: until }, ...withEndpoints }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH }),
    async (row) => {
      const makerspace = await prisma.makerspace.findUnique({ where: { id: row.makerspaceId }, select: { slug: true } });
      if (!makerspace) return null;
      return {
        type: "finance.entry_posted", slug: makerspace.slug,
        data: { entry: { id: row.id, direction: row.direction, category: row.category, amountMinor: row.amountMinor, currency: row.currency, method: row.method, occurredAt: row.occurredAt.toISOString(), sourceType: row.sourceType, sourceId: row.sourceId, spaceId: row.spaceId, bookingId: row.bookingId, issueId: row.issueId, reversesId: row.reversesId } },
      };
    });
  return issues + entries;
}
