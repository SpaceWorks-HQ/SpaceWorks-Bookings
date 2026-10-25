import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { webhookEventFor, webhookPayload } from "./events";

/**
 * The booking timeline (`BookingEvent`, append-only, written in each change's transaction) is the webhook outbox.
 * Every run relays events from a few minutes before the cursor up to SETTLE ago into WebhookDelivery rows for the
 * makerspace's active endpoints subscribed to them. Rows are unique per (endpoint, event), so overlapping scans and
 * concurrent runs never deliver twice, and a transaction that committed late (its `createdAt` is its start) is
 * still picked up by the overlap. Endpoints only receive events from after they were created.
 */

const CURSOR = "booking-events";
const OVERLAP_MS = 5 * 60_000;
const SETTLE_MS = 10_000;
const BATCH = 500;

export async function relayWebhookEvents(now = new Date()): Promise<number> {
  const cursor = await prisma.webhookRelayCursor.findUnique({ where: { id: CURSOR } });
  const from = cursor ? new Date(cursor.createdAt.getTime() - OVERLAP_MS) : new Date(now.getTime() - OVERLAP_MS);
  const until = new Date(now.getTime() - SETTLE_MS);
  const events = await prisma.bookingEvent.findMany({
    where: { createdAt: { gte: from, lt: until }, makerspace: { webhookEndpoints: { some: { isActive: true } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH,
    select: { id: true, kind: true, createdAt: true, makerspaceId: true, bookingId: true, occurrenceId: true, data: true },
  });
  let queued = 0;
  const endpointsBySpace = new Map<string, Array<{ id: string; events: string[]; createdAt: Date }>>();
  for (const event of events) {
    const type = webhookEventFor(event.kind);
    if (!type) continue;
    if (!endpointsBySpace.has(event.makerspaceId)) {
      endpointsBySpace.set(event.makerspaceId, await prisma.webhookEndpoint.findMany({ where: { makerspaceId: event.makerspaceId, isActive: true }, select: { id: true, events: true, createdAt: true } }));
    }
    const endpoints = endpointsBySpace.get(event.makerspaceId)!.filter((endpoint) => endpoint.events.includes(type) && endpoint.createdAt <= event.createdAt);
    if (endpoints.length === 0) continue;
    const booking = await prisma.booking.findUnique({
      where: { id: event.bookingId },
      include: { space: { select: { slug: true } }, makerspace: { select: { slug: true } }, occurrences: { orderBy: [{ startsAt: "asc" }, { unit: "asc" }], select: { id: true, startsAt: true, endsAt: true, status: true } } },
    });
    if (!booking) continue;
    const payload = webhookPayload({ eventId: event.id, event: type, createdAt: event.createdAt, makerspaceSlug: booking.makerspace.slug, occurrenceId: event.occurrenceId, data: event.data, booking, now });
    const created = await prisma.webhookDelivery.createMany({
      data: endpoints.map((endpoint) => ({ makerspaceId: event.makerspaceId, endpointId: endpoint.id, event: type, eventId: event.id, payload: payload as unknown as Prisma.InputJsonValue, nextAttemptAt: now })),
      skipDuplicates: true,
    });
    queued += created.count;
  }
  const last = events.at(-1);
  if (last) {
    await prisma.webhookRelayCursor.upsert({ where: { id: CURSOR }, create: { id: CURSOR, createdAt: last.createdAt, eventId: last.id }, update: { createdAt: last.createdAt, eventId: last.id } });
  } else if (!cursor) {
    await prisma.webhookRelayCursor.create({ data: { id: CURSOR, createdAt: until, eventId: "" } }).catch(() => undefined);
  }
  return queued;
}
