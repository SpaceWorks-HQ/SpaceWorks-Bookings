import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffContext } from "@/lib/actions/bookingContext";
import { resolveFinancialDate } from "@/lib/actions/financialDate";

const mocks = vi.hoisted(() => ({ payout: vi.fn(), manual: vi.fn(), makerspace: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { makerspace: { findUniqueOrThrow: mocks.makerspace } } }));
vi.mock("@/lib/actions/bookingContext", () => ({
  staffAction: async (schema: { parse(input: unknown): Record<string, unknown> }, input: unknown, _capability: unknown,
    work: (data: Record<string, unknown>, context: StaffContext) => Promise<unknown>) => work(schema.parse(input), {
    makerspaceId: "tenant", actor: { kind: "STAFF", userId: "manager", role: "BOOKINGS_MANAGER" },
  }),
}));
vi.mock("@/lib/actionRateLimit", () => ({}));
vi.mock("@/lib/repairs/issues", () => ({}));
vi.mock("@/lib/repairs/requests", () => ({}));
vi.mock("@/lib/repairs/photos", () => ({}));
vi.mock("@/lib/repairs/payouts", () => ({ recordRepairPayout: mocks.payout }));
vi.mock("@/lib/finance/ledger", () => ({ postManualEntry: mocks.manual }));

const { recordRepairPayout } = await import("@/app/actions/repairs");
const { postFinanceEntry } = await import("@/app/actions/finance");
const realPayouts = await vi.importActual<typeof import("@/lib/repairs/payouts")>("@/lib/repairs/payouts");
const realLedger = await vi.importActual<typeof import("@/lib/finance/ledger")>("@/lib/finance/ledger");

beforeEach(() => { vi.clearAllMocks(); mocks.manual.mockResolvedValue({ id: "entry" }); });

describe("financial actions resolve the authorised makerspace's calendar day", () => {
  it.each([
    ["Asia/Kolkata", "2026-10-30", "2026-10-29T18:30:00.000Z"],
    ["America/Los_Angeles", "2026-10-29", "2026-10-29T07:00:00.000Z"],
  ])("normalises payout and ledger forms in %s", async (timezone, day, instant) => {
    mocks.makerspace.mockResolvedValue({ slug: "tinkerspace", timezone });
    await recordRepairPayout({ makerspaceSlug: "tinkerspace", issueId: "issue", amountMinor: 75000, method: "CASH", paidAt: day });
    expect(mocks.payout).toHaveBeenCalledWith(expect.objectContaining({ makerspaceId: "tenant", paidAt: new Date(instant) }));
    await postFinanceEntry({ makerspaceSlug: "tinkerspace", direction: "OUT", category: "SUPPLIES", amountMinor: 75000, method: "CASH", occurredAt: day, note: "Repair" });
    expect(mocks.manual).toHaveBeenCalledWith(expect.objectContaining({ makerspaceId: "tenant", occurredAt: new Date(instant) }));
    for (const [query] of mocks.makerspace.mock.calls) expect(query.where).toEqual({ id: "tenant" });
  });

  it("keeps real payout and ledger future-instant guards before any database operation", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-29T20:34:00Z"));
    const scope = { makerspaceId: "tenant", actor: { kind: "STAFF" as const, userId: "manager", role: "BOOKINGS_MANAGER" as const } };
    const future = resolveFinancialDate("2026-10-31", "Asia/Kolkata");
    try {
      // No DB implementation: a future date must be refused before entering a transaction.
      await expect(realPayouts.recordRepairPayout({ ...scope, issueId: "issue", amountMinor: 75000, method: "CASH", reference: null, paidAt: future, note: "" }, {} as never)).rejects.toThrow(/future/);
      await expect(realLedger.postManualEntry({ ...scope, direction: "OUT", category: "SUPPLIES", amountMinor: 75000, method: "CASH", reference: null, occurredAt: future, note: "Repair" }, {} as never)).rejects.toThrow(/future/);
    } finally { clock.mockRestore(); }
  });
});
