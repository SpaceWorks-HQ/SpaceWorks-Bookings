import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: null as string | null, ip: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => identity.userId ? { user: { id: identity.userId } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": identity.ip }) }));

import { prisma } from "@/lib/db";
import { updateBookingSettings, updateSpaceRuleOverrides } from "@/app/actions/booking-settings";
import { createSpace, updateSpace, setSpaceArchived } from "@/app/actions/spaces";
import { addSpace, NOW } from "./bookings-helpers";
import { auditFor, dataOf, resetActionRequest, setupActionMakerspace, type ActionFixture } from "./booking-actions-helpers";

let fixture: ActionFixture;
let stranger: ActionFixture;

describe.sequential("booking settings Server Actions", () => {
  beforeAll(async () => { fixture = await setupActionMakerspace(); stranger = await setupActionMakerspace(); });
  beforeEach(() => { resetActionRequest(identity); identity.userId = fixture.owner.userId; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(async () => { await fixture.cleanup(); await stranger.cleanup(); });

  it("saves makerspace defaults and per-space overrides with field diffs, then restores inheritance", async () => {
    const space = await addSpace(fixture.makerspaceId);
    const rules = dataOf(await updateBookingSettings({ ...fixture.scope, patch: { leadTimeMinutes: 120 } }));
    expect(rules.leadTimeMinutes).toBe(120);
    expect(await auditFor(fixture.makerspaceId, fixture.makerspaceId, "booking-rules")).toEqual([
      expect.objectContaining({ actorUserId: fixture.owner.userId, metadata: {
        area: "booking-rules", operation: "updated", changes: { leadTimeMinutes: { from: 60, to: 120 } },
      } }),
    ]);
    const override = dataOf(await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: space.id, patch: { leadTimeMinutes: 30 } }));
    expect(override).toMatchObject({ values: { leadTimeMinutes: 30 }, sources: { leadTimeMinutes: "space" } });
    expect(await auditFor(fixture.makerspaceId, space.id, "space-rules")).toEqual([
      expect.objectContaining({ metadata: { area: "space-rules", operation: "updated", changes: { leadTimeMinutes: { from: null, to: 30 } } } }),
    ]);
    expect(dataOf(await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: space.id, patch: { leadTimeMinutes: null } })))
      .toMatchObject({ values: { leadTimeMinutes: 120 }, sources: { leadTimeMinutes: "makerspace" } });
    // An unchanged default must not produce another audit row.
    dataOf(await updateBookingSettings({ ...fixture.scope, patch: { leadTimeMinutes: 120 } }));
    expect(await auditFor(fixture.makerspaceId, fixture.makerspaceId, "booking-rules")).toHaveLength(1);
  });

  it("refuses money rules to a bookings manager, without changing the space or the audit trail", async () => {
    const manager = await fixture.staff("BOOKINGS_MANAGER");
    const space = await addSpace(fixture.makerspaceId);
    identity.userId = manager.userId;
    dataOf(await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: space.id, patch: { leadTimeMinutes: 15 } }));
    const auditCount = await prisma.auditEvent.count({ where: { makerspaceId: fixture.makerspaceId } });
    expect(await updateBookingSettings({ ...fixture.scope, patch: { chargeMode: "PAY_LATER" } })).toMatchObject({ ok: false });
    expect(await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: space.id, patch: { chargeMode: "PAY_LATER" } })).toMatchObject({ ok: false });
    expect(await updateSpace({ ...fixture.scope, spaceId: space.id, fields: { taxRateBps: 1800 } })).toMatchObject({ ok: false });
    expect((await prisma.space.findUniqueOrThrow({ where: { id: space.id } })).ruleOverrides).toEqual({ leadTimeMinutes: 15 });
    expect((await prisma.makerspaceBookingSettings.findUniqueOrThrow({ where: { makerspaceId: fixture.makerspaceId } })).chargeMode).toBe("FREE");
    expect(await prisma.auditEvent.count({ where: { makerspaceId: fixture.makerspaceId } })).toBe(auditCount);
  });

  it("creates, updates and archives a space, auditing actual field values", async () => {
    const space = dataOf(await createSpace({ ...fixture.scope, fields: { name: "Meeting room", kind: "ROOM", capacity: 10, publicHourlyMinor: 0, published: true } }));
    expect(space).toMatchObject({ makerspaceId: fixture.makerspaceId, slug: "meeting-room", published: true });
    expect(await auditFor(fixture.makerspaceId, space.id, "space")).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ operation: "created", changes: expect.objectContaining({ name: { from: null, to: "Meeting room" } }) }) }),
    ]);
    dataOf(await updateSpace({ ...fixture.scope, spaceId: space.id, fields: { capacity: 12, amenities: ["Whiteboard"] } }));
    expect(await auditFor(fixture.makerspaceId, space.id, "space")).toContainEqual(
      expect.objectContaining({ metadata: { area: "space", operation: "updated", changes: { capacity: { from: 10, to: 12 }, amenities: { from: [], to: ["Whiteboard"] } } } }),
    );
    dataOf(await setSpaceArchived({ ...fixture.scope, spaceId: space.id, archived: true }));
    expect(await prisma.space.findUniqueOrThrow({ where: { id: space.id } })).toMatchObject({ archivedAt: NOW, published: false });
    expect(await auditFor(fixture.makerspaceId, space.id, "space")).toContainEqual(
      expect.objectContaining({ metadata: { area: "space", operation: "updated", changes: { archivedAt: { from: null, to: NOW.toISOString() }, published: { from: true, to: false } } } }),
    );
  });

  it("answers not found for space ids from another makerspace", async () => {
    const theirs = await addSpace(stranger.makerspaceId);
    for (const result of [
      await updateSpace({ ...fixture.scope, spaceId: theirs.id, fields: { name: "Stolen" } }),
      await setSpaceArchived({ ...fixture.scope, spaceId: theirs.id, archived: true }),
      await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: theirs.id, patch: { leadTimeMinutes: 0 } }),
    ]) expect(result).toEqual({ ok: false, error: "Space not found." });
    expect(await prisma.space.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ name: "Studio A", archivedAt: null });
  });

  it("keeps front desk out of both settings scopes and space management", async () => {
    identity.userId = (await fixture.staff("FRONT_DESK")).userId;
    const space = await addSpace(fixture.makerspaceId);
    for (const result of [
      await updateBookingSettings({ ...fixture.scope, patch: { leadTimeMinutes: 0 } }),
      await updateSpaceRuleOverrides({ ...fixture.scope, spaceId: space.id, patch: { leadTimeMinutes: 0 } }),
      await createSpace({ ...fixture.scope, fields: { name: "Forbidden" } }),
    ]) expect(result).toEqual({ ok: false, error: "Your role doesn't allow this." });
  });
});
