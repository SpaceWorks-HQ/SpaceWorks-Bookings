import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { canMove, cleanSkills, payoutState, requestChannels } from "@/lib/repairs/rules";
import { financeTotals, groupBy, series, signedAmount, spaceRepairCosts, type LedgerRow } from "@/lib/finance/summary";
import { sheetXml, workbook } from "@/lib/finance/xlsx";
import { can, CAPABILITIES, roleHome } from "@/lib/permissionRoles";

const row = (over: Partial<LedgerRow>): LedgerRow => ({ direction: "IN", category: "BOOKING_PAYMENT", amountMinor: 1000, currency: "INR", method: "UPI", occurredAt: new Date("2030-01-10T10:00:00Z"), spaceId: "s1", ...over });

describe("repair rules", () => {
  it("moves an issue only along its lifecycle", () => {
    expect(canMove("REPORTED", "request")).toBe(true);
    expect(canMove("ASSIGNED", "request")).toBe(false);
    expect(canMove("ASSIGNED", "fix")).toBe(true);
    expect(canMove("REPORTED", "fix")).toBe(false);
    expect(canMove("FIXED", "close")).toBe(true);
    expect(canMove("ASSIGNED", "close")).toBe(false);
    expect(canMove("CLOSED", "reopen")).toBe(true);
    expect(canMove("CLOSED", "assign")).toBe(false);
  });

  it("says where the money for a repair stands", () => {
    expect(payoutState({ amountAskedMinor: null, approvedMinor: null, paidMinor: 0 })).toBe("NOTHING_ASKED");
    expect(payoutState({ amountAskedMinor: 500, approvedMinor: null, paidMinor: 0 })).toBe("TO_APPROVE");
    expect(payoutState({ amountAskedMinor: 500, approvedMinor: 400, paidMinor: 0 })).toBe("UNPAID");
    expect(payoutState({ amountAskedMinor: 500, approvedMinor: 400, paidMinor: 100 })).toBe("PARTLY_PAID");
    expect(payoutState({ amountAskedMinor: 500, approvedMinor: 400, paidMinor: 400 })).toBe("PAID");
    expect(payoutState({ amountAskedMinor: 500, approvedMinor: 0, paidMinor: 0 })).toBe("PAID");
  });

  it("tidies skills and picks the channels both sides have", () => {
    expect(cleanSkills([" AC ", "ac", "Air  Con", "", "x".repeat(40)])).toEqual(["ac", "air con", "x".repeat(30)]);
    const contact = { kind: "EXTERNAL" as const, email: "a@b.test", whatsapp: "+919800000000", telegramChatId: null };
    expect(requestChannels(contact, { whatsapp: true, telegram: true })).toEqual(["EMAIL", "WHATSAPP"]);
    expect(requestChannels(contact, { whatsapp: false, telegram: true })).toEqual(["EMAIL"]);
    expect(requestChannels({ ...contact, kind: "STAFF", whatsapp: null }, { whatsapp: true, telegram: true })).toEqual(["INBOX", "EMAIL"]);
  });
});

describe("finance maths", () => {
  const rows = [
    row({ amountMinor: 10_000 }),
    row({ direction: "OUT", category: "REFUND", amountMinor: 2_000 }),
    row({ direction: "OUT", category: "REPAIR_PAYOUT", amountMinor: 3_000, method: "CASH" }),
    row({ direction: "OUT", category: "RENT", amountMinor: 5_000, spaceId: null, method: "BANK_TRANSFER" }),
    row({ direction: "IN", category: "RENT", amountMinor: 5_000, spaceId: null, method: "BANK_TRANSFER" }),
    row({ currency: "USD", amountMinor: 999 }),
  ];

  it("counts a reversal against its category, never as income, and never mixes currencies", () => {
    expect(signedAmount(row({ direction: "IN", category: "RENT", amountMinor: 5 }))).toBe(-5);
    expect(financeTotals(rows, "INR")).toEqual({ income: 10_000, expenses: 5_000, net: 5_000 });
    expect(financeTotals(rows, "USD")).toEqual({ income: 999, expenses: 0, net: 999 });
  });

  it("groups by category and leaves out what nets to nothing", () => {
    expect(groupBy(rows, "INR", (item) => item.category).map((group) => [group.key, group.income, group.expenses])).toEqual([["BOOKING_PAYMENT", 10_000, 0], ["REPAIR_PAYOUT", 0, 3_000], ["REFUND", 0, 2_000]]);
  });

  it("spreads money over buckets and sets repairs against each space's revenue", () => {
    const at = (iso: string) => new Date(iso).getTime();
    expect(series(rows, "INR", [{ from: at("2030-01-01T00:00:00Z"), to: at("2030-01-10T00:00:00Z") }, { from: at("2030-01-10T00:00:00Z"), to: at("2030-01-11T00:00:00Z") }]))
      .toEqual({ income: [0, 10_000], expenses: [0, 5_000] });
    expect(spaceRepairCosts(rows, "INR").get("s1")).toEqual({ revenue: 8_000, repairs: 3_000 });
  });
});

describe("Excel export", () => {
  it("writes a zip of the workbook parts with typed cells and formula-safe text", () => {
    const xml = sheetXml(["Name", "Amount"], [["=HYPERLINK(\"x\")", 12.5], ["Tea & <cake>", null]]);
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">\'=HYPERLINK(&quot;x&quot;)</t></is></c><c r="B2"><v>12.5</v></c>');
    expect(xml).toContain("Tea &amp; &lt;cake&gt;");
    const file = workbook("Finance", ["A"], [[1]]);
    expect(file.readUInt32LE(0)).toBe(0x04034b50);
    expect(file.subarray(file.length - 22).readUInt32LE(0)).toBe(0x06054b50);
    const names: string[] = [];
    for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
      const nameLength = file.readUInt16LE(offset + 26);
      const size = file.readUInt32LE(offset + 18);
      names.push(file.subarray(offset + 30, offset + 30 + nameLength).toString());
      if (names.at(-1) === "xl/worksheets/sheet1.xml") expect(inflateRawSync(file.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size)).toString()).toContain("<v>");
      offset += 30 + nameLength + size;
    }
    expect(names).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]);
  });
});

describe("who sees repairs and money", () => {
  it("keeps finance with the bookings manager and technicians on their repairs", () => {
    for (const capability of ["finance.view", "finance.manage", "repairs.pay", "repairs.manage", "payments.view", "reports.finance", "refunds.manage"] as const) {
      expect((CAPABILITIES[capability] as readonly string[])).toEqual(["BOOKINGS_MANAGER"]);
    }
    expect(can("TECHNICIAN", "repairs.work")).toBe(true);
    expect(can("TECHNICIAN", "issues.report")).toBe(true);
    for (const capability of ["makerspace.view", "bookings.view", "issues.view", "reports.view", "payments.record"] as const) expect(can("TECHNICIAN", capability)).toBe(false);
    expect(can("FRONT_DESK", "payments.record")).toBe(true);
    expect(roleHome("tinkerspace", "TECHNICIAN")).toBe("/dashboard/tinkerspace/issues");
    expect(roleHome("tinkerspace", "FRONT_DESK")).toBe("/dashboard/tinkerspace");
  });
});
