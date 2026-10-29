import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => identity.userId ? { user: { id: identity.userId }, authenticatedAt: Date.now() } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prisma } = await import("@/lib/db");
const { deleteMakerspace } = await import("@/app/actions/team");
const { setupActionMakerspace } = await import("./booking-actions-helpers");
const { addSpace, book } = await import("./bookings-helpers");
const { postManualEntry } = await import("@/lib/finance/ledger");
type Fixture = Awaited<ReturnType<typeof setupActionMakerspace>>;
const fixtures: Fixture[] = [];
async function fixture() {
  const f = await setupActionMakerspace({ chargeMode: "FREE" });
  fixtures.push(f);
  identity.userId = f.owner.userId;
  return f;
}
const auditCount = (f: Fixture) => prisma.auditEvent.count({ where: { action: "MAKERSPACE_DELETED", targetId: f.makerspaceId } });
afterEach(() => { identity.userId = null; });
afterAll(async () => {
  for (const f of fixtures) await f.cleanup();
  await prisma.$disconnect();
});

describe("makerspace deletion", () => {
  it("deletes an unused makerspace and commits one instance audit record", async () => {
    const f = await fixture();
    await addSpace(f.makerspaceId);
    expect(await deleteMakerspace(f.scope)).toEqual({ ok: true });
    expect(await prisma.makerspace.findUnique({ where: { id: f.makerspaceId } })).toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { action: "MAKERSPACE_DELETED", targetId: f.makerspaceId } })).toMatchObject({ makerspaceId: null, actorUserId: f.owner.userId });
    expect(await auditCount(f)).toBe(1);
  });

  it("retains free booking timelines and provides archive guidance without claiming deletion", async () => {
    const f = await fixture();
    const space = await addSpace(f.makerspaceId);
    const { held } = await book(f, space.id, [30, 32]);
    expect(await deleteMakerspace(f.scope)).toMatchObject({ ok: false, error: expect.stringMatching(/booking or repair history.*archive/) });
    expect(await prisma.booking.findUnique({ where: { id: held.bookingId } })).not.toBeNull();
    expect(await prisma.bookingEvent.count({ where: { bookingId: held.bookingId } })).toBeGreaterThan(0);
    expect(await auditCount(f)).toBe(0);
  });

  it("retains financial records even when no booking exists", async () => {
    const f = await fixture();
    const entry = await postManualEntry({ makerspaceId: f.makerspaceId, actor: f.owner, direction: "OUT", category: "RENT", amountMinor: 1000, method: "CASH", reference: null, occurredAt: new Date(), note: "Rent" });
    expect(await deleteMakerspace(f.scope)).toMatchObject({ ok: false, error: expect.stringMatching(/records must be kept/) });
    expect(await prisma.financeEntry.findUnique({ where: { id: entry.id } })).not.toBeNull();
    expect(await auditCount(f)).toBe(0);
  });

  it("denies another tenant's staff and keeps suspended makerspaces", async () => {
    const f = await fixture();
    const other = await fixture();
    identity.userId = other.owner.userId;
    expect(await deleteMakerspace(f.scope)).toMatchObject({ ok: false });
    identity.userId = f.owner.userId;
    await prisma.makerspace.update({ where: { id: f.makerspaceId }, data: { status: "SUSPENDED" } });
    expect(await deleteMakerspace(f.scope)).toMatchObject({ ok: false, error: expect.stringMatching(/suspended or archived/) });
    expect(await auditCount(f)).toBe(0);
  });
});
