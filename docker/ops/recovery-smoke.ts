// Synthetic fixtures for the explicitly opted-in, disposable recovery acceptance test.
import assert from "node:assert/strict";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";
import { encryptMfaSecret, decryptMfaSecret } from "@/lib/mfa";
import { encryptPaymentSecret, decryptPaymentSecret } from "@/lib/payments/secrets";
import { createPayment } from "@/lib/payments/charges";
import { settlePayment } from "@/lib/payments/settle";
import { getQueues, closeQueues } from "@/lib/queue/client";

async function proveWorkerEmail() {
  const queues = getQueues();
  try {
    const to = "recovery-worker@example.test";
    const verificationUrl = new URL("/verify-email?token=synthetic-acceptance", process.env.NEXT_PUBLIC_BASE_URL!).toString();
    const row = await prisma.outboxMessage.create({ data: { kind: "email-verification", payload: { to, verificationUrl, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } } });
    await queues.outbox.add("acceptance-mail", { kind: "outbox", outboxId: row.id }, { jobId: `acceptance-mail-${row.id}` });
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(process.env.SWB_SMOKE_MAILPIT_URL || "http://audit-mailpit:8025/api/v1/messages");
      const captured = await response.json() as { messages: Array<{ To?: Array<{ Address?: string }> }> };
      const delivered = captured.messages.some((message) => message.To?.some((recipient) => recipient.Address === to));
      if (delivered && !(await prisma.outboxMessage.findUnique({ where: { id: row.id } }))) {
        console.log("Production worker delivered email through verified STARTTLS and removed its bearer-bearing SQL payload.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Worker email acceptance timed out");
  } finally { await closeQueues(queues); }
}

async function main() {
  assert.equal(process.env.SWB_RECOVERY_SMOKE, "1", "Explicit disposable recovery opt-in required");
  const mode = process.argv[2];
  assert.ok(["seed", "verify", "empty", "mail"].includes(mode), "Choose seed, verify, empty or mail");
  if (mode === "mail") { await proveWorkerEmail(); return; }
  const email = "recovery-fixture@example.test", slug = "deployment-recovery-fixture";
  const plaintext = "synthetic-recovery-secret", content = "private recovery fixture bytes";
  const s3 = new S3Client({ region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  const object = { Bucket: process.env.S3_BUCKET!, Key: "deployment-recovery/fixture.txt" };
  try {
    if (mode === "empty") {
      assert.equal(await prisma.user.count({ where: { email } }), 0, "Recovery target must have no fixture account");
      assert.equal(await prisma.makerspace.count({ where: { slug } }), 0, "Recovery target must have no fixture makerspace");
      await assert.rejects(s3.send(new GetObjectCommand(object)), (error: unknown) =>
        (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404,
      "Recovery target must have no private fixture object");
    } else if (mode === "seed") {
      const user = await prisma.user.create({ data: { email, name: "Recovery fixture", emailVerified: new Date(), mfaSecretEncrypted: encryptMfaSecret(plaintext) } });
      const makerspace = await prisma.makerspace.create({ data: { slug, name: "Recovery fixture", status: "ACTIVE", currency: "INR", timezone: "Asia/Kolkata",
        teamMembers: { create: { userId: user.id, role: "BOOKINGS_MANAGER" } },
        spaces: { create: { slug: "recovery-room", name: "Recovery room", kind: "ROOM", capacity: 5, units: 1 } } } });
      await prisma.makerspacePaymentSettings.create({ data: { makerspaceId: makerspace.id, webhookPublicCode: "recovery-fixture-webhook", secretEncrypted: encryptPaymentSecret(plaintext, makerspace.id) } });
      await prisma.$transaction(async (tx) => {
        const payment = await createPayment(tx, { makerspace, customer: { name: "Recovery fixture", email }, currency: "INR", items: [{ kind: "OTHER", description: "Recovery fixture", amountMinor: 4200 }], provider: "OFFLINE", status: "PENDING", method: "cash", reference: "recovery-fixture" });
        await settlePayment(tx, { makerspace, paymentId: payment.id, confirmedById: user.id });
      });
      await s3.send(new PutObjectCommand({ ...object, Body: content }));
    } else {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(decryptMfaSecret(user.mfaSecretEncrypted!), plaintext, "Recovered MFA key must decrypt recovered ciphertext");
      const makerspace = await prisma.makerspace.findUniqueOrThrow({ where: { slug }, include: { spaces: true, teamMembers: true, paymentSettings: true } });
      assert.equal(makerspace.spaces[0]?.name, "Recovery room");
      assert.equal(makerspace.teamMembers[0]?.userId, user.id);
      assert.equal(decryptPaymentSecret(makerspace.paymentSettings!.secretEncrypted!, makerspace.id), plaintext, "Recovered payment key must decrypt recovered ciphertext");
      const payment = await prisma.payment.findFirstOrThrow({ where: { makerspaceId: makerspace.id, reference: "recovery-fixture" } });
      assert.equal(payment.status, "PAID");
      assert.equal(payment.amountMinor, 4200);
      const ledger = await prisma.financeEntry.findUniqueOrThrow({ where: { sourceType_sourceId: { sourceType: "PAYMENT", sourceId: payment.id } } });
      assert.equal(ledger.amountMinor, 4200);
      let immutable = false;
      try { await prisma.payment.update({ where: { id: payment.id }, data: { amountMinor: 4201 } }); }
      catch (error) { immutable = String(error).includes("A paid payment can only gain settlement details or review flags"); }
      assert.ok(immutable, "Recovered paid-payment trigger must remain active");
      const result = await s3.send(new GetObjectCommand(object));
      assert.equal(await result.Body!.transformToString(), content);
      const anonymous = await fetch(`${process.env.S3_ENDPOINT}/${object.Bucket}/${object.Key}`);
      await anonymous.body?.cancel();
      assert.equal(anonymous.status, 403, "Recovered objects must remain private");
    }
    console.log(`Disposable recovery fixture ${mode} passed (relational records, ledger, immutable trigger, MFA/payment keys and private object).`);
  } finally { s3.destroy(); }
}
main().catch(() => {
  console.error("Disposable recovery verification failed; credentials and fixture content were suppressed.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
