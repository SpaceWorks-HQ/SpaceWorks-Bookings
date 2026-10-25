import crypto from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/net/publicHost", async (importOriginal) => ({ ...(await importOriginal<object>()), assertPublicHost: vi.fn(async (host: string) => { if (host === "10.0.0.5") throw Object.assign(new Error("private"), { name: "PrivateHostError" }); }) }));

const { prisma } = await import("@/lib/db");
const { addSpace, setupMakerspace, book, NOW } = await import("./bookings-helpers");
const { createApiKey, revokeApiKey } = await import("@/lib/integrations/apiKeys");
const endpoints = await import("@/lib/integrations/webhooks/endpoints");
const { relayWebhookEvents } = await import("@/lib/integrations/webhooks/relay");
const { deliverDueWebhooks, DISABLE_AFTER } = await import("@/lib/integrations/webhooks/deliver");
const spacesRoute = await import("@/app/api/v1/spaces/route");
const bookingsRoute = await import("@/app/api/v1/bookings/route");
const bookingRoute = await import("@/app/api/v1/bookings/[reference]/route");
const cancelRoute = await import("@/app/api/v1/bookings/[reference]/cancel/route");
const membersRoute = await import("@/app/api/v1/members/route");

/** These tests run on the real clock (the API and jobs use it), so times are relative to now. */
const soon = (hours: number) => new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + hours * 3_600_000);
const fixtures: Array<Awaited<ReturnType<typeof setupMakerspace>>> = [];
async function fixture() {
  const created = await setupMakerspace({ chargeMode: "FREE" });
  fixtures.push(created);
  return { ...created, space: await addSpace(created.makerspaceId, { publicHourlyMinor: 0, publicHalfDayMinor: null, publicDayMinor: null, memberHourlyMinor: null }) };
}
const call = (handler: (request: Request, context: never) => Promise<Response> | Response, token: string | null, init: { method?: string; url?: string; body?: unknown; params?: Record<string, string> } = {}) =>
  handler(new Request(`http://localhost/api/v1${init.url ?? ""}`, { method: init.method ?? "GET", headers: token ? { authorization: `Bearer ${token}` } : {}, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve(init.params ?? {}) } as never);

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const item of fixtures) {
    await prisma.webhookRelayCursor.deleteMany({});
    await item.cleanup();
  }
  await prisma.$disconnect();
});

describe("REST API", () => {
  it("authenticates keys, enforces scopes and keeps makerspaces apart", async () => {
    const f = await fixture();
    const other = await fixture();
    const read = await createApiKey({ makerspaceId: f.makerspaceId, name: "Reader", scopes: ["read"], actorUserId: f.owner.userId });
    const write = await createApiKey({ makerspaceId: f.makerspaceId, name: "Writer", scopes: ["read", "write"], actorUserId: f.owner.userId });
    const foreign = await createApiKey({ makerspaceId: other.makerspaceId, name: "Other", scopes: ["read", "write"], actorUserId: other.owner.userId });

    expect((await call(spacesRoute.GET, null)).status).toBe(401);
    expect((await call(spacesRoute.GET, `${read.token}x`)).status).toBe(401);
    const spaces = await (await call(spacesRoute.GET, read.token)).json();
    expect(spaces.data.map((space: { id: string }) => space.id)).toEqual([f.space.id]);
    expect((await call(bookingsRoute.POST, read.token, { method: "POST", body: {} })).status).toBe(403);

    const invalid = await call(bookingsRoute.POST, write.token, { method: "POST", body: { spaceId: f.space.id } });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("INVALID_INPUT");

    const created = await call(bookingsRoute.POST, write.token, { method: "POST", body: { spaceId: f.space.id, start: soon(30).toISOString(), end: soon(32).toISOString(), attendees: 2, customer: { name: "Asha Menon", email: "asha@example.test" } } });
    expect(created.status).toBe(201);
    const booking = (await created.json()).data;
    expect(booking).toMatchObject({ status: "CONFIRMED", source: "API", customer: { email: "asha@example.test" } });
    const again = await call(bookingsRoute.POST, write.token, { method: "POST", body: { spaceId: f.space.id, start: soon(30).toISOString(), end: soon(32).toISOString(), customer: { name: "B", email: "b@example.test" } } });
    expect(again.status).toBe(409);

    expect((await call(bookingRoute.GET, foreign.token, { params: { reference: booking.reference } })).status).toBe(404);
    const list = await (await call(bookingsRoute.GET, read.token, { url: "/bookings?limit=1" })).json();
    expect(list.data).toHaveLength(1);

    const cancelled = await call(cancelRoute.POST, write.token, { method: "POST", params: { reference: booking.reference }, body: { reason: "Not needed" } });
    expect((await cancelled.json()).data.status).toBe("CANCELLED");

    const member = await call(membersRoute.PUT, write.token, { method: "PUT", body: { email: "Member@Example.test", name: "Mem Ber" } });
    expect((await member.json()).data.email).toBe("member@example.test");
    expect((await call(membersRoute.DELETE, write.token, { method: "DELETE", url: "/members?email=member@example.test" })).status).toBe(204);

    await revokeApiKey({ makerspaceId: f.makerspaceId, keyId: read.id, actorUserId: f.owner.userId });
    expect((await call(spacesRoute.GET, read.token)).status).toBe(401);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: write.id } })).lastUsedAt).not.toBeNull();
  });
});

describe("webhooks", () => {
  it("relays subscribed booking events once, signs deliveries and retries failures", async () => {
    const f = await fixture();
    const created = await endpoints.createEndpoint({ makerspaceId: f.makerspaceId, actorUserId: f.owner.userId, endpoint: { url: "https://hooks.example.test/in", events: ["booking.confirmed", "booking.cancelled"] } });
    await expect(endpoints.createEndpoint({ makerspaceId: f.makerspaceId, actorUserId: f.owner.userId, endpoint: { url: "https://10.0.0.5/x", events: ["booking.confirmed"] } })).rejects.toThrow(/private/);
    await book(f, f.space.id, [40, 42], { hold: { start: soon(40), end: soon(42), now: new Date() }, submit: { now: new Date() } });
    const later = new Date(Date.now() + 60_000);
    await relayWebhookEvents(later);
    await relayWebhookEvents(later);
    const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: created.id } });
    expect(deliveries.map((delivery) => delivery.event)).toEqual(["booking.confirmed"]);

    const sent: Array<{ body: string; signature: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      sent.push({ body: String(init?.body), signature: new Headers(init?.headers).get("x-spaceworks-signature") ?? "" });
      return new Response(null, { status: sent.length === 1 ? 500 : 204 });
    });
    await deliverDueWebhooks(later);
    let delivery = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveries[0].id } });
    expect(delivery).toMatchObject({ status: "PENDING", attempts: 1, responseStatus: 500 });
    await deliverDueWebhooks(new Date(delivery.nextAttemptAt!.getTime() + 1000));
    delivery = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveries[0].id } });
    expect(delivery).toMatchObject({ status: "DELIVERED", attempts: 2 });
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent[1].signature)!;
    const { decryptMakerspaceSecret } = await import("@/lib/makerspaceSecrets");
    const endpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    expect(decryptMakerspaceSecret(endpoint.secretEncrypted, f.makerspaceId, "webhook")).toBe(created.secret);
    expect(crypto.createHmac("sha256", created.secret).update(`${t}.${sent[1].body}`).digest("hex")).toBe(v1);
    expect(JSON.parse(sent[1].body)).toMatchObject({ type: "booking.confirmed", makerspace: f.makerspace.slug });
    expect(sent[1].body).not.toContain("@");
  });

  it("switches an endpoint off after repeated failures and pings on demand", async () => {
    const f = await fixture();
    const created = await endpoints.createEndpoint({ makerspaceId: f.makerspaceId, actorUserId: f.owner.userId, endpoint: { url: "https://down.example.test/", events: ["booking.confirmed"] } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    await prisma.webhookEndpoint.update({ where: { id: created.id }, data: { consecutiveFailures: DISABLE_AFTER - 2 } });
    expect((await endpoints.pingEndpoint({ makerspaceId: f.makerspaceId, endpointId: created.id }))).toMatchObject({ ok: false, status: 503 });
    expect(await endpoints.pingEndpoint({ makerspaceId: f.makerspaceId, endpointId: created.id })).toMatchObject({ ok: false });
    const endpoint = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    expect(endpoint).toMatchObject({ isActive: false, consecutiveFailures: DISABLE_AFTER });
    expect(await prisma.webhookDelivery.count({ where: { endpointId: created.id, status: "PENDING" } })).toBe(0);
    void NOW;
  });
});
