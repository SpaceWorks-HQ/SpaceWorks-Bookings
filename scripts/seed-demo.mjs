#!/usr/bin/env node
// Demo data for local QA and the end-to-end tests: one active makerspace and its owner. No super admin.
//
//   DEMO_PASSWORD=<12+ chars> DEMO_MFA_SECRET=<base32> MFA_ENCRYPTION_KEY=<base64 32 bytes> npm run db:seed-demo
//
// The owner signs in as owner@demo.test with DEMO_PASSWORD; staff need an authenticator before the dashboard opens,
// so DEMO_MFA_SECRET is their TOTP seed. Idempotent; never runs in production. Phase 1 adds spaces and bookings.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

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
  where: { email: "owner@demo.test" },
  create: { email: "owner@demo.test", name: "Shaan Shoukath", ...credentials },
  update: { name: "Shaan Shoukath", ...credentials, isSuperAdmin: false },
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
  create: { userId: owner.id, makerspaceId: makerspace.id, role: "OWNER" },
  update: { role: "OWNER" },
});
if (!(await prisma.makerspaceReview.count({ where: { makerspaceId: makerspace.id } }))) {
  await prisma.makerspaceReview.create({ data: { makerspaceId: makerspace.id, action: "CREATED", actorUserId: null } });
}

await prisma.$disconnect();
console.log("Seeded the Tinkerspace demo makerspace (/m/tinkerspace) and its owner, owner@demo.test.");
