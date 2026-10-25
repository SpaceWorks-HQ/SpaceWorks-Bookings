#!/usr/bin/env node
// Demo data for local QA and the end-to-end tests. No super admin.
//
//   DEMO_PASSWORD=<12+ chars> DEMO_MFA_SECRET=<base32> MFA_ENCRYPTION_KEY=<base64 32 bytes> npm run db:seed-demo
//
// The bookings manager signs in as manager@demo.test with DEMO_PASSWORD; staff need an authenticator before the dashboard opens,
// so DEMO_MFA_SECRET is their shared TOTP seed. Idempotent; never runs in production.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { seedBookingCatalogue } from "./seed/booking-catalogue.mjs";
import { seedBookings } from "./seed/bookings.mjs";
import { seedMoney } from "./seed/money.mjs";
import { seedRepairs } from "./seed/repairs.mjs";

if (process.env.NODE_ENV === "production") throw new Error("seed-demo never runs in production.");
const password = process.env.DEMO_PASSWORD ?? "";
if (password.length < 12) throw new Error("Set DEMO_PASSWORD (at least 12 characters).");
const mfaSecret = process.env.DEMO_MFA_SECRET ?? "";
if (!/^[A-Z2-7]{16,}$/.test(mfaSecret)) throw new Error("Set DEMO_MFA_SECRET to a base32 TOTP seed (16+ characters, A-Z and 2-7).");

function encryptMfaSecret(secret) {
  const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be base64 for a 32-byte key.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

const prisma = new PrismaClient();
const now = new Date();
const credentials = { emailVerified: now, passwordHash: await bcrypt.hash(password, 12), mfaSecretEncrypted: encryptMfaSecret(mfaSecret), mfaEnabledAt: now };
const owner = await prisma.user.upsert({
  where: { email: "manager@demo.test" },
  create: { email: "manager@demo.test", name: "Shaan Shoukath", ...credentials },
  update: { name: "Shaan Shoukath", ...credentials, isSuperAdmin: false },
});
const front = await prisma.user.upsert({
  where: { email: "front@demo.test" },
  create: { email: "front@demo.test", name: "Diya Nair", ...credentials },
  update: { name: "Diya Nair", ...credentials, isSuperAdmin: false },
});
const technician = await prisma.user.upsert({
  where: { email: "tech@demo.test" },
  create: { email: "tech@demo.test", name: "Arjun Pillai", ...credentials },
  update: { name: "Arjun Pillai", ...credentials, isSuperAdmin: false },
});
const customer = await prisma.user.upsert({
  where: { email: "customer@demo.test" },
  create: { email: "customer@demo.test", name: "Asha Menon", emailVerified: now, passwordHash: credentials.passwordHash },
  update: { name: "Asha Menon", emailVerified: now, passwordHash: credentials.passwordHash, isSuperAdmin: false,
    mfaSecretEncrypted: null, mfaEnabledAt: null },
});

const details = {
  name: "Tinkerspace", kind: "Makerspace", status: "ACTIVE", source: "SUPERADMIN", visibility: "PUBLIC",
  description: "A shared workshop in Alappuzha with a laser studio, a meeting room, hot desks and a hall for weekend build nights.",
  contactEmail: "hello@tinkerspace.demo.test", contactPhone: "+91 98470 12345", city: "Alappuzha", stateCode: "KL",
  country: "IN", timezone: "Asia/Kolkata", currency: "INR", website: "https://tinkerspace.demo.test",
};
const makerspace = await prisma.makerspace.upsert({ where: { slug: "tinkerspace" }, create: { slug: "tinkerspace", ...details }, update: details });
await prisma.teamMember.upsert({
  where: { userId_makerspaceId: { userId: owner.id, makerspaceId: makerspace.id } },
  create: { userId: owner.id, makerspaceId: makerspace.id, role: "BOOKINGS_MANAGER" },
  update: { role: "BOOKINGS_MANAGER" },
});
await prisma.teamMember.upsert({
  where: { userId_makerspaceId: { userId: front.id, makerspaceId: makerspace.id } },
  create: { userId: front.id, makerspaceId: makerspace.id, role: "FRONT_DESK" },
  update: { role: "FRONT_DESK" },
});
await prisma.teamMember.upsert({
  where: { userId_makerspaceId: { userId: technician.id, makerspaceId: makerspace.id } },
  create: { userId: technician.id, makerspaceId: makerspace.id, role: "TECHNICIAN" },
  update: { role: "TECHNICIAN" },
});
if (!(await prisma.makerspaceReview.count({ where: { makerspaceId: makerspace.id } }))) {
  await prisma.makerspaceReview.create({ data: { makerspaceId: makerspace.id, action: "CREATED", actorUserId: null } });
}

try {
  const spaces = await seedBookingCatalogue(prisma, makerspace.id);
  await seedBookings(prisma, { makerspaceId: makerspace.id, spaces, owner, front, customer, now });
  await seedMoney(prisma, { makerspaceId: makerspace.id, owner, now });
  await seedRepairs(prisma, { makerspaceId: makerspace.id, spaces, owner, technician, now });
} finally {
  await prisma.$disconnect();
}
console.log("Seeded Tinkerspace (/m/tinkerspace), spaces and bookings; manager@demo.test, front@demo.test, tech@demo.test and customer@demo.test.");
