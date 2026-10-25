// Stable ids and upserts keep repeated demo setup from multiplying catalogue rows.
export const refundTiers = [
  { minHoursBefore: 48, refundBps: 10_000 },
  { minHoursBefore: 24, refundBps: 5000 },
  { minHoursBefore: 0, refundBps: 0 },
];

export async function seedBookingCatalogue(prisma, makerspaceId) {
  const settings = { guestBookingAllowed: true, leadTimeMinutes: 0, minDurationMinutes: 30,
    maxDurationMinutes: 720, slotStepMinutes: 30, chargeMode: "FREE", approvalMode: "INSTANT",
    requestExpiryHours: 168, customerRescheduleCutoffHours: 0, reminderHoursBefore: [24, 2] };
  await prisma.makerspaceBookingSettings.upsert({ where: { makerspaceId }, create: { makerspaceId, ...settings }, update: settings });
  await prisma.$transaction(async (tx) => {
    await tx.openingHours.deleteMany({ where: { makerspaceId, spaceId: null } });
    await tx.openingHours.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ makerspaceId, weekday, openMinute: 540, closeMinute: 1260 })) });
    await tx.refundTier.deleteMany({ where: { makerspaceId, spaceId: null } });
    await tx.refundTier.createMany({ data: refundTiers.map((tier) => ({ makerspaceId, ...tier })) });
  });
  const catalogue = [
    { slug: "laser-studio", name: "Laser studio", kind: "STUDIO", capacity: 4,
      summary: "A quiet studio for planning and finishing laser projects.", amenities: ["Work tables", "Extraction", "Wi-Fi"],
      publicHourlyMinor: 80_000, memberHourlyMinor: 60_000, ruleOverrides: { chargeMode: "PAY_NOW", approvalMode: "APPROVAL" } },
    { slug: "meeting-room", name: "Meeting room", kind: "ROOM", capacity: 10,
      summary: "Meet your team, share ideas and plan your next build.", amenities: ["Whiteboard", "Display", "Wi-Fi"],
      publicHourlyMinor: 0, ruleOverrides: { chargeMode: "FREE", approvalMode: "INSTANT" } },
    { slug: "hot-desks", name: "Hot desks", kind: "DESK", capacity: 1, units: 8,
      summary: "Bring your laptop and work alongside other makers.", amenities: ["Power sockets", "Wi-Fi", "Drinking water"],
      publicHalfDayMinor: 30_000, publicDayMinor: 50_000, memberHalfDayMinor: 20_000, memberDayMinor: 35_000,
      ruleOverrides: { chargeMode: "PAY_LATER", minDurationMinutes: 240, maxDurationMinutes: 480 } },
    { slug: "build-hall", name: "Build hall", kind: "HALL", capacity: 60,
      summary: "An open hall for community builds, talks and workshops.", amenities: ["Flexible seating", "Projector", "Accessible entrance"],
      publicHourlyMinor: 200_000, memberHourlyMinor: 150_000,
      ruleOverrides: { chargeMode: "DEPOSIT", approvalMode: "APPROVAL", depositPercentBps: 2500 } },
  ];
  const spaces = {};
  for (const [index, entry] of catalogue.entries()) {
    const data = { units: 1, publicHourlyMinor: null, publicHalfDayMinor: null, publicDayMinor: null,
      memberHourlyMinor: null, memberHalfDayMinor: null, memberDayMinor: null, ...entry,
      description: entry.summary, published: true, archivedAt: null, sortOrder: index * 10 };
    spaces[entry.slug] = await prisma.space.upsert({ where: { makerspaceId_slug: { makerspaceId, slug: entry.slug } },
      create: { makerspaceId, ...data }, update: data });
  }
  const extras = [
    { name: "Projector hire", spaceId: spaces["build-hall"].id, unit: "PER_BOOKING", priceMinor: 50_000, memberPriceMinor: 30_000 },
    { name: "Tea and coffee", spaceId: null, unit: "PER_PERSON", priceMinor: 5000, memberPriceMinor: 3000 },
  ];
  for (const [index, extra] of extras.entries()) {
    const id = `demo-${makerspaceId}-extra-${index}`;
    await prisma.addOn.upsert({ where: { id }, create: { id, makerspaceId, ...extra }, update: extra });
  }
  const peak = { makerspaceId, spaceId: spaces["build-hall"].id, name: "Saturday evenings", weekdays: [6],
    startMinute: 1080, endMinute: 1260, surchargeBps: 2500, active: true };
  const peakId = `demo-${makerspaceId}-peak`;
  await prisma.peakRule.upsert({ where: { id: peakId }, create: { id: peakId, ...peak }, update: peak });
  for (const [email, name] of [["customer@demo.test", "Asha Menon"], ["ravi@demo.test", "Ravi Kumar"], ["leela@demo.test", "Leela Joseph"]]) {
    await prisma.makerspaceMember.upsert({ where: { makerspaceId_email: { makerspaceId, email } },
      create: { makerspaceId, email, name, note: "Demo member rate" }, update: { name, active: true } });
  }
  return spaces;
}
