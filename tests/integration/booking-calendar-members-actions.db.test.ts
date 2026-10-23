import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ userId: null as string | null, ip: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => identity.userId ? { user: { id: identity.userId } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": identity.ip }) }));

import { prisma } from "@/lib/db";
import * as calendar from "@/app/actions/space-calendar";
import { upsertMember, importMembersCsv, removeMember } from "@/app/actions/members";
import { addSpace } from "./bookings-helpers";
import { auditFor, dataOf, resetActionRequest, setupActionMakerspace, type ActionFixture } from "./booking-actions-helpers";

let fixture: ActionFixture;
let stranger: ActionFixture;
const hours = [{ weekday: 1, openMinute: 540, closeMinute: 1260 }];
const exception = { date: "2030-01-10", closed: true, reason: "Team day" };
const blackout = { startDate: "2030-01-12", endDate: "2030-01-13", reason: "Painting" };

describe.sequential("calendar and member Server Actions", () => {
  beforeAll(async () => { fixture = await setupActionMakerspace(); stranger = await setupActionMakerspace(); });
  beforeEach(() => { resetActionRequest(identity); identity.userId = fixture.owner.userId; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(async () => { await fixture.cleanup(); await stranger.cleanup(); });

  it("allows a bookings manager to change one space's hours, exceptions and blackouts only", async () => {
    const space = await addSpace(fixture.makerspaceId);
    identity.userId = (await fixture.staff("BOOKINGS_MANAGER")).userId;
    for (const spaceId of [null, space.id]) {
      const scope = { ...fixture.scope, spaceId };
      const results = [await calendar.replaceOpeningHours({ ...scope, hours }),
        await calendar.setHoursException({ ...scope, exception }), await calendar.createBlackout({ ...scope, blackout })];
      for (const result of results) expect(result.ok).toBe(spaceId !== null);
    }
    expect(await prisma.openingHours.findMany({ where: { makerspaceId: fixture.makerspaceId, spaceId: null } })).toEqual([]);
    expect(await prisma.hoursException.count({ where: { makerspaceId: fixture.makerspaceId, spaceId: null } })).toBe(0);
    expect(await prisma.blackout.count({ where: { makerspaceId: fixture.makerspaceId, spaceId: null } })).toBe(0);
    expect(await auditFor(fixture.makerspaceId, space.id, "opening-hours")).toEqual([
      expect.objectContaining({ metadata: { area: "opening-hours", operation: "updated", changes: { hours: { from: [], to: hours } } } }),
    ]);
    const savedException = await prisma.hoursException.findFirstOrThrow({ where: { spaceId: space.id } });
    const savedBlackout = await prisma.blackout.findFirstOrThrow({ where: { spaceId: space.id } });
    expect(await calendar.removeHoursException({ ...fixture.scope, spaceId: null, exceptionId: savedException.id })).toMatchObject({ ok: false });
    expect(await calendar.removeBlackout({ ...fixture.scope, spaceId: null, blackoutId: savedBlackout.id })).toMatchObject({ ok: false });
    expect(await calendar.removeHoursException({ ...fixture.scope, spaceId: space.id, exceptionId: savedException.id })).toMatchObject({ ok: true });
    expect(await calendar.removeBlackout({ ...fixture.scope, spaceId: space.id, blackoutId: savedBlackout.id })).toMatchObject({ ok: true });
  });

  it("lets the owner save makerspace hours, dated exceptions and blackouts, and prevents scope spoofing", async () => {
    dataOf(await calendar.replaceOpeningHours({ ...fixture.scope, hours }));
    const savedException = dataOf(await calendar.setHoursException({ ...fixture.scope, exception }));
    const savedBlackout = dataOf(await calendar.createBlackout({ ...fixture.scope, blackout }));
    expect(savedException).toMatchObject({ makerspaceId: fixture.makerspaceId, spaceId: null, closed: true, intervals: [] });
    expect(savedBlackout).toMatchObject({ spaceId: null, reason: "Painting" });
    identity.userId = (await fixture.staff("BOOKINGS_MANAGER")).userId;
    const space = await addSpace(fixture.makerspaceId);
    expect(await calendar.removeHoursException({ ...fixture.scope, spaceId: space.id, exceptionId: savedException.id })).toEqual({ ok: false, error: "Exception not found." });
    expect(await calendar.removeBlackout({ ...fixture.scope, spaceId: space.id, blackoutId: savedBlackout.id })).toEqual({ ok: false, error: "Blackout not found." });
    expect(await prisma.hoursException.findUnique({ where: { id: savedException.id } })).not.toBeNull();
    expect(await prisma.blackout.findUnique({ where: { id: savedBlackout.id } })).not.toBeNull();
    identity.userId = fixture.owner.userId;
    expect(await calendar.removeHoursException({ ...fixture.scope, exceptionId: savedException.id })).toMatchObject({ ok: true });
    expect(await calendar.removeBlackout({ ...fixture.scope, blackoutId: savedBlackout.id })).toMatchObject({ ok: true });
  });

  it("upserts members and imports CSV atomically, keeping personal data out of the audit", async () => {
    const member = dataOf(await upsertMember({ ...fixture.scope, member: { email: "ASHA@example.test", name: "Asha", note: "Private note" } }));
    expect(member.email).toBe("asha@example.test");
    const updated = dataOf(await upsertMember({ ...fixture.scope, member: { email: "asha@example.test", name: "Asha Menon", validUntil: "2030-12-31" } }));
    expect(updated.id).toBe(member.id);
    expect(await auditFor(fixture.makerspaceId, member.id, "member")).toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ changes: expect.objectContaining({ name: { from: "[redacted]", to: "[redacted]" },
        validUntil: { from: null, to: "2030-12-31" } }) }) }),
    );
    expect(JSON.stringify(await auditFor(fixture.makerspaceId, member.id, "member"))).not.toMatch(/asha@example|Asha|Private note/);
    const csv = 'email,name,valid_until,note\nasha@example.test,"Menon, Asha",2031-01-31,Renewed\nravi@example.test,Ravi,,New';
    expect(dataOf(await importMembersCsv({ ...fixture.scope, csv }))).toEqual({ imported: 2, errors: [] });
    expect(await prisma.makerspaceMember.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ name: "Menon, Asha", validUntil: new Date("2031-01-31") });
    expect(dataOf(await importMembersCsv({ ...fixture.scope, csv: "email,name\nnever@example.test,Valid\ninvalid,Invalid" })))
      .toMatchObject({ imported: 0, errors: [expect.objectContaining({ line: 3 })] });
    expect(await prisma.makerspaceMember.count({ where: { makerspaceId: fixture.makerspaceId, email: "never@example.test" } })).toBe(0);
  });

  it("returns not found for another makerspace's calendar and member ids", async () => {
    const theirs = await addSpace(stranger.makerspaceId);
    for (const result of [await calendar.replaceOpeningHours({ ...fixture.scope, spaceId: theirs.id, hours }),
      await calendar.setHoursException({ ...fixture.scope, spaceId: theirs.id, exception }),
      await calendar.createBlackout({ ...fixture.scope, spaceId: theirs.id, blackout })]) {
      expect(result).toEqual({ ok: false, error: "Space not found." });
    }
    identity.userId = stranger.owner.userId;
    const ex = dataOf(await calendar.setHoursException({ ...stranger.scope, exception }));
    const bl = dataOf(await calendar.createBlackout({ ...stranger.scope, blackout }));
    const member = dataOf(await upsertMember({ ...stranger.scope, member: { email: "theirs@example.test" } }));
    identity.userId = fixture.owner.userId;
    expect(await calendar.removeHoursException({ ...fixture.scope, exceptionId: ex.id })).toEqual({ ok: false, error: "Exception not found." });
    expect(await calendar.removeBlackout({ ...fixture.scope, blackoutId: bl.id })).toEqual({ ok: false, error: "Blackout not found." });
    expect(await removeMember({ ...fixture.scope, memberId: member.id })).toEqual({ ok: false, error: "Member not found." });
  });
});
