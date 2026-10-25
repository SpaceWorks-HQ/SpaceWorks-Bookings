import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffActor } from "@/lib/bookings/actor";
import { prisma } from "@/lib/db";
import { addExternalTechnician, addStaffTechnician } from "@/lib/repairs/technicians";
import { assignTechnician, closeIssue, recordFix, reopenIssue, reportIssue, setOutOfService } from "@/lib/repairs/issues";
import { answerAsStaff, answerByLink, expireRepairRequests, sendRequests } from "@/lib/repairs/requests";
import { approveRepairAmount, recordRepairPayout } from "@/lib/repairs/payouts";
import { addSpace, setupMakerspace, type Fixture } from "./bookings-helpers";

let fixture: Fixture;
let stranger: Fixture;
let technicianUser: StaffActor;
let spaceId: string;

const report = (title = "The AC doesn't cool") => reportIssue({ makerspaceId: fixture.makerspaceId, spaceId, actor: fixture.owner, title, description: "Warm air only", severity: "HIGH" });
const external = (name: string, email: string) => addExternalTechnician({ makerspaceId: fixture.makerspaceId, actor: fixture.owner, fields: { name, email, skills: ["AC", " Electrical "] } });
/** The link token a request email carried (the outbox payload is the only place it exists in clear). */
async function tokenFor(requestId: string) {
  const rows = await prisma.outboxMessage.findMany({ where: { kind: "repair-request" } });
  const row = rows.find((message) => (message.payload as { requestId?: string }).requestId === requestId);
  return (row?.payload as { url: string }).url.split("/repair/")[1];
}
const issueOf = (id: string) => prisma.spaceIssue.findUniqueOrThrow({ where: { id } });

describe.sequential("repairs", () => {
  beforeAll(async () => {
    fixture = await setupMakerspace();
    stranger = await setupMakerspace();
    spaceId = (await addSpace(fixture.makerspaceId)).id;
    technicianUser = await fixture.staff("TECHNICIAN");
  });
  afterAll(async () => { await fixture.cleanup(); await stranger.cleanup(); });

  it("asks the chosen technicians; the first to accept takes it and the others are told", async () => {
    const issue = await report();
    const asha = await external("Asha Electricals", "asha@repairs.test");
    const ravi = await external("Ravi Cooling", "ravi@repairs.test");
    const staff = await addStaffTechnician({ makerspaceId: fixture.makerspaceId, actor: fixture.owner, userId: technicianUser.userId, skills: ["ac"] });
    expect(asha.skills).toEqual(["ac", "electrical"]);
    await expect(sendRequests({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianIds: [asha.id], actor: technicianUser })).rejects.toThrow();
    expect(await sendRequests({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianIds: [asha.id, ravi.id, staff.id], actor: fixture.owner })).toEqual({ sent: 3 });
    const requests = await prisma.repairRequest.findMany({ where: { issueId: issue.id } });
    expect(requests.map((row) => row.status)).toEqual(["SENT", "SENT", "SENT"]);
    expect(requests.find((row) => row.technicianId === staff.id)).toMatchObject({ tokenHash: null, channels: ["INBOX", "EMAIL"] });
    const ashaToken = await tokenFor(requests.find((row) => row.technicianId === asha.id)!.id);
    const results = await Promise.allSettled([
      answerByLink({ token: ashaToken, answer: "ACCEPT" }),
      answerAsStaff({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: technicianUser, answer: "ACCEPT" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const after = await issueOf(issue.id);
    expect(after.status).toBe("ASSIGNED");
    expect([asha.id, staff.id]).toContain(after.technicianId);
    const statuses = (await prisma.repairRequest.findMany({ where: { issueId: issue.id } })).map((row) => row.status).sort();
    expect(statuses).toEqual(["ACCEPTED", "CLOSED", "CLOSED"]);
    const taken = await prisma.outboxMessage.findMany({ where: { kind: "repair-notice" } });
    expect(taken.filter((row) => (row.payload as { issueId: string; notice: string }).issueId === issue.id && (row.payload as { notice: string }).notice === "taken")).toHaveLength(2);
    expect(await prisma.issueEvent.count({ where: { issueId: issue.id, kind: "requested" } })).toBe(3);
  });

  it("takes the work through the link, then verifies, reopens, approves and pays without overpaying", async () => {
    const issue = await report("The projector won't start");
    const tech = await external("Meera AV", "meera@repairs.test");
    await sendRequests({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianIds: [tech.id], actor: fixture.owner });
    const request = await prisma.repairRequest.findFirstOrThrow({ where: { issueId: issue.id } });
    const token = await tokenFor(request.id);
    await answerByLink({ token, answer: "ACCEPT" });
    const link = { kind: "LINK" as const, technicianId: tech.id };
    await expect(recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: { kind: "LINK", technicianId: "someone-else" }, remarks: "Done", partsUsed: "", amountAskedMinor: 1 })).rejects.toThrow("Issue not found.");
    await recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: link, remarks: "Replaced the lamp", partsUsed: "Lamp", amountAskedMinor: 150_000 });
    expect(await issueOf(issue.id)).toMatchObject({ status: "FIXED", amountAskedMinor: 150_000 });
    await reopenIssue({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, reason: "Flickers" });
    expect((await issueOf(issue.id)).status).toBe("ASSIGNED");
    await recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: link, remarks: "Replaced the cable too", partsUsed: "Lamp, HDMI", amountAskedMinor: 150_000 });
    await closeIssue({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner });
    await expect(approveRepairAmount({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, amountMinor: 120_000, note: "" })).rejects.toThrow("Say why");
    await approveRepairAmount({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, amountMinor: 120_000, note: "Agreed by phone" });
    const pay = (amountMinor: number, method: "CASH" | "UPI", reference: string | null) => recordRepairPayout({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, amountMinor, method, reference, paidAt: new Date(), note: "" });
    await expect(pay(100_000, "UPI", null)).rejects.toThrow("reference");
    await pay(100_000, "UPI", "UPI-1234");
    await expect(pay(30_000, "CASH", null)).rejects.toThrow("more than is left");
    await pay(20_000, "CASH", null);
    const entries = await prisma.financeEntry.findMany({ where: { issueId: issue.id }, orderBy: { amountMinor: "desc" } });
    expect(entries.map((row) => [row.direction, row.category, row.amountMinor, row.method, row.spaceId])).toEqual([["OUT", "REPAIR_PAYOUT", 100_000, "UPI", spaceId], ["OUT", "REPAIR_PAYOUT", 20_000, "CASH", spaceId]]);
    const payout = await prisma.repairPayout.findFirstOrThrow({ where: { issueId: issue.id } });
    await expect(prisma.repairPayout.update({ where: { id: payout.id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(prisma.repairPayout.delete({ where: { id: payout.id } })).rejects.toThrow();
    await expect(recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: link, remarks: "Again", partsUsed: "", amountAskedMinor: 150_000 })).rejects.toThrow();
  });

  it("refuses other roles, other makerspaces and technicians who weren't asked", async () => {
    const issue = await report("Lights flicker");
    const front = await fixture.staff("FRONT_DESK");
    await expect(closeIssue({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: front })).rejects.toThrow();
    await expect(approveRepairAmount({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: technicianUser, amountMinor: 1, note: "x" })).rejects.toThrow();
    await expect(answerAsStaff({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: technicianUser, answer: "ACCEPT" })).rejects.toThrow("Issue not found.");
    await expect(closeIssue({ makerspaceId: stranger.makerspaceId, issueId: issue.id, actor: stranger.owner })).rejects.toThrow("Issue not found.");
    await expect(sendRequests({ makerspaceId: stranger.makerspaceId, makerspaceSlug: stranger.makerspace.slug, issueId: issue.id, technicianIds: ["x"], actor: stranger.owner })).rejects.toThrow();
    await expect(answerByLink({ token: "A".repeat(43), answer: "ACCEPT" })).rejects.toThrow("Request not found.");
  });

  it("blocks bookings while out of service and lifts the block when the issue closes", async () => {
    const issue = await report("Leaking roof");
    await setOutOfService({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, today: "2030-01-07", until: "2030-01-20" });
    const blocked = await issueOf(issue.id);
    expect(await prisma.blackout.findUnique({ where: { id: blocked.blackoutId! } })).toMatchObject({ spaceId, reason: `Out of service: ${issue.reference}` });
    const tech = await external("Roofers", "roof@repairs.test");
    await sendRequests({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianIds: [tech.id], actor: fixture.owner });
    await answerByLink({ token: await tokenFor((await prisma.repairRequest.findFirstOrThrow({ where: { issueId: issue.id } })).id), answer: "ACCEPT" });
    await recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, remarks: "Sealed", partsUsed: "", amountAskedMinor: null });
    await closeIssue({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner });
    expect(await prisma.blackout.findUnique({ where: { id: blocked.blackoutId! } })).toBeNull();
    expect((await issueOf(issue.id)).blackoutId).toBeNull();
  });

  it("answers a request once, and keeps an approved repair with its technician", async () => {
    const issue = await report("Fan rattles");
    const first = await external("Fans One", "fan1@repairs.test");
    const second = await external("Fans Two", "fan2@repairs.test");
    await sendRequests({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianIds: [first.id], actor: fixture.owner });
    const token = await tokenFor((await prisma.repairRequest.findFirstOrThrow({ where: { issueId: issue.id } })).id);
    const answers = await Promise.allSettled([answerByLink({ token, answer: "DECLINE" }), answerByLink({ token, answer: "ACCEPT" })]);
    expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
    const request = await prisma.repairRequest.findFirstOrThrow({ where: { issueId: issue.id } });
    expect((await issueOf(issue.id)).status).toBe(request.status === "ACCEPTED" ? "ASSIGNED" : "REPORTED");
    const assign = (technicianId: string) => assignTechnician({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianId, actor: fixture.owner });
    await assign(first.id);
    await recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, remarks: "Tightened", partsUsed: "", amountAskedMinor: 5_000 });
    await reopenIssue({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, reason: "Still rattles" });
    await assign(second.id);
    expect(await issueOf(issue.id)).toMatchObject({ technicianId: second.id, amountAskedMinor: null, fixRemarks: "" });
    await recordFix({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, remarks: "Replaced the bearing", partsUsed: "", amountAskedMinor: 8_000 });
    await approveRepairAmount({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, amountMinor: 8_000, note: "" });
    await reopenIssue({ makerspaceId: fixture.makerspaceId, issueId: issue.id, actor: fixture.owner, reason: "Noise again" });
    await expect(assign(first.id)).rejects.toThrow("stays with its technician");
  });

  it("expires requests nobody answered", async () => {
    const issue = await report("Door lock stuck");
    const tech = await external("Locksmith", "lock@repairs.test");
    await sendRequests({ makerspaceId: fixture.makerspaceId, makerspaceSlug: fixture.makerspace.slug, issueId: issue.id, technicianIds: [tech.id], actor: fixture.owner });
    await expireRepairRequests(new Date(Date.now() + 4 * 86_400_000));
    expect(await prisma.repairRequest.findFirstOrThrow({ where: { issueId: issue.id } })).toMatchObject({ status: "EXPIRED", tokenHash: null });
    expect(await prisma.issueEvent.count({ where: { issueId: issue.id, kind: "request-expired" } })).toBe(1);
  });
});
