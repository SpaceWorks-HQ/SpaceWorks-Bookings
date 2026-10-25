// Demo repairs: the technician directory (one team technician, two outside), an open AC issue waiting for someone to
// take it, and a projector repair that was fixed, verified and paid (its payout posts to the finance ledger by trigger).
// Plus one hand-posted expense (rent). Idempotent: rows are keyed by their reference or source.

const DAY = 86_400_000;

export async function seedRepairs(prisma, { makerspaceId, spaces, owner, technician, now }) {
  const room = spaces["meeting-room"];
  const studio = spaces["laser-studio"];
  const directory = [
    { kind: "STAFF", userId: technician.id, name: technician.name, email: technician.email, skills: ["electrical", "av", "laser"] },
    { kind: "EXTERNAL", userId: null, name: "Ravi Cooling Services", email: "ravi.cooling@example.com", whatsapp: "+919847011111", skills: ["ac", "refrigeration"] },
    { kind: "EXTERNAL", userId: null, name: "Meera AV Repairs", email: "meera.av@example.com", skills: ["projectors", "av"] },
  ];
  const technicians = [];
  for (const row of directory) {
    const existing = await prisma.technician.findFirst({ where: { makerspaceId, name: row.name } });
    technicians.push(existing ?? await prisma.technician.create({ data: { makerspaceId, ...row } }));
  }
  const [, ravi, meera] = technicians;

  if (!(await prisma.spaceIssue.findUnique({ where: { makerspaceId_reference: { makerspaceId, reference: "IS-DE0001" } } }))) {
    const issue = await prisma.spaceIssue.create({ data: { makerspaceId, spaceId: room.id, reference: "IS-DE0001", title: "The AC isn't cooling", description: "It blows warm air after ten minutes.", severity: "HIGH", reporterKind: "STAFF", reportedById: owner.id, currency: "INR", createdAt: new Date(now.getTime() - 2 * 3_600_000) } });
    await prisma.issueEvent.create({ data: { makerspaceId, issueId: issue.id, kind: "reported", actorKind: "STAFF", actorUserId: owner.id, data: { severity: "HIGH" } } });
    await prisma.repairRequest.create({ data: { makerspaceId, issueId: issue.id, technicianId: ravi.id, channels: ["EMAIL", "WHATSAPP"], expiresAt: new Date(now.getTime() + 3 * DAY), sentById: owner.id } });
    await prisma.issueEvent.create({ data: { makerspaceId, issueId: issue.id, kind: "requested", actorKind: "STAFF", actorUserId: owner.id, technicianId: ravi.id, data: { channels: ["EMAIL", "WHATSAPP"] } } });
  }

  if (!(await prisma.spaceIssue.findUnique({ where: { makerspaceId_reference: { makerspaceId, reference: "IS-DE0002" } } }))) {
    const at = (days) => new Date(now.getTime() - days * DAY);
    await prisma.$transaction(async (tx) => {
      const issue = await tx.spaceIssue.create({
        data: {
          makerspaceId, spaceId: studio.id, reference: "IS-DE0002", title: "The projector won't turn on", severity: "MEDIUM", status: "CLOSED", reporterKind: "STAFF", reportedById: owner.id,
          technicianId: meera.id, assignedAt: at(6), fixRemarks: "Replaced the lamp and cleaned the filter.", partsUsed: "Projector lamp", amountAskedMinor: 450_000, currency: "INR",
          fixedAt: at(5), approvedMinor: 450_000, approvedById: owner.id, closedAt: at(5), closedById: owner.id, createdAt: at(7),
        },
      });
      for (const [kind, days, technicianId, data] of [["reported", 7, null, {}], ["accepted", 6, meera.id, {}], ["fixed", 5, meera.id, { amountAskedMinor: 450_000 }], ["closed", 5, meera.id, {}], ["approved", 5, meera.id, { amountMinor: 450_000 }]]) {
        await tx.issueEvent.create({ data: { makerspaceId, issueId: issue.id, kind, actorKind: kind === "accepted" || kind === "fixed" ? "TECHNICIAN" : "STAFF", actorUserId: kind === "accepted" || kind === "fixed" ? null : owner.id, technicianId, data, createdAt: at(days) } });
      }
      const payout = await tx.repairPayout.create({ data: { makerspaceId, issueId: issue.id, technicianId: meera.id, amountMinor: 450_000, currency: "INR", method: "UPI", reference: "UPI-DEMO-4521", paidAt: at(4), paidById: owner.id } });
      await tx.issueEvent.create({ data: { makerspaceId, issueId: issue.id, kind: "paid", actorKind: "STAFF", actorUserId: owner.id, technicianId: meera.id, data: { payoutId: payout.id, amountMinor: 450_000 }, createdAt: at(4) } });
    });
  }

  if (!(await prisma.financeEntry.findFirst({ where: { makerspaceId, sourceType: "MANUAL", note: "Workshop rent" } }))) {
    const id = crypto.randomUUID();
    await prisma.financeEntry.create({ data: { id, makerspaceId, direction: "OUT", category: "RENT", amountMinor: 3_500_000, currency: "INR", method: "BANK_TRANSFER", reference: "NEFT-DEMO-1001", occurredAt: new Date(now.getTime() - 3 * DAY), sourceType: "MANUAL", sourceId: id, actorUserId: owner.id, note: "Workshop rent" } });
  }
}
