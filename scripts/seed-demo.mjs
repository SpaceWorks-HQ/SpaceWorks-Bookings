#!/usr/bin/env node
// Demo data for local QA: platform admin, team accounts and makerspaces in every review state.
//
//   DEMO_PASSWORD=<12+ chars> [DEMO_MFA_SECRET=<base32> MFA_ENCRYPTION_KEY=<base64 32 bytes>] npm run db:seed-demo
//
// Every account uses DEMO_PASSWORD. With DEMO_MFA_SECRET the platform admin also has two-step
// verification on (the super-admin panel requires it). Idempotent; never runs in production.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("seed-demo never runs in production.");
const password = process.env.DEMO_PASSWORD ?? "";
if (password.length < 12) throw new Error("Set DEMO_PASSWORD (at least 12 characters).");

function encryptMfaSecret(secret) {
  const key = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be base64 for a 32-byte key.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash(password, 12);
const now = new Date();

async function user(email, name, extra = {}) {
  return prisma.user.upsert({
    where: { email },
    create: { email, name, emailVerified: now, passwordHash, ...extra },
    update: { name, emailVerified: now, passwordHash, ...extra },
  });
}

const mfa = process.env.DEMO_MFA_SECRET ? { mfaSecretEncrypted: encryptMfaSecret(process.env.DEMO_MFA_SECRET), mfaEnabledAt: now } : {};
const admin = await user("admin@demo.test", "Shaan Shoukath", { isSuperAdmin: true, ...mfa });
// Staff need an authenticator before the dashboard opens; with DEMO_MFA_SECRET the demo staff share one.
const owner = await user("owner@demo.test", "Abhiram NJ", mfa);
const treasurer = await user("treasurer@demo.test", "Abdul Samad MJ", mfa);
const applicant = await user("applicant@demo.test", "Midlaj C");

const base = { country: "IN", timezone: "Asia/Kolkata", currency: "INR", stateCode: "KL" };
const makerspaces = [
  {
    slug: "spaceworks", name: "SpaceWorks", kind: "Community", status: "ACTIVE", city: "Kochi",
    description: "Open-source tools and a community of makers who build them together, with chapters across Kerala.",
    contactEmail: "hello@spaceworks.demo.test", team: [[owner, "OWNER"], [treasurer, "TREASURER"]],
    reviews: [["SUBMITTED", owner, null], ["APPROVED", admin, null]],
  },
  {
    slug: "kunj-company", name: "Kunj-Company", kind: "Company club", status: "PENDING_REVIEW", city: "Kozhikode",
    description: "A members' club for the Kunj-Company team and friends, with monthly meet-ups and learning sessions.",
    contactEmail: "office@kunj-company.demo.test", team: [[applicant, "OWNER"]],
    reviews: [["SUBMITTED", applicant, null]],
  },
  {
    slug: "ideologists", name: "Ideologists", kind: "Society", status: "CHANGES_REQUESTED", city: "Thrissur",
    description: "A society for people who turn ideas into projects, with talks, mentoring and an annual showcase.",
    contactEmail: "hello@ideologists.demo.test", team: [[applicant, "OWNER"]],
    reviews: [["SUBMITTED", applicant, null], ["CHANGES_REQUESTED", admin, "Please add your full address and a contact phone number."]],
  },
  {
    slug: "tinkerspace", name: "Tinkerspace", kind: "Makerspace", status: "SUSPENDED", city: "Alappuzha",
    description: "A shared workshop with tools, workbenches and weekend build nights for members around Alappuzha.",
    contactEmail: "hello@tinkerspace.demo.test", team: [[owner, "OWNER"]],
    reviews: [["SUBMITTED", owner, null], ["APPROVED", admin, null], ["SUSPENDED", admin, "Suspended while we confirm the workshop's insurance cover."]],
  },
];

for (const { team, reviews, ...data } of makerspaces) {
  const existing = await prisma.makerspace.findUnique({ where: { slug: data.slug }, select: { id: true } });
  if (existing) continue;
  const makerspace = await prisma.makerspace.create({ data: { ...base, ...data } });
  for (const [member, role] of team) await prisma.teamMember.create({ data: { makerspaceId: makerspace.id, userId: member.id, role } });
  let at = Date.now() - reviews.length * 3_600_000;
  for (const [action, actor, reason] of reviews) {
    await prisma.makerspaceReview.create({ data: { makerspaceId: makerspace.id, action, actorUserId: actor.id, reason, createdAt: new Date((at += 3_600_000)) } });
  }
}

await prisma.$disconnect();
console.log(`seed-demo: ${makerspaces.length} makerspaces and 4 accounts (admin, owner, treasurer, applicant @demo.test) ready.`);
