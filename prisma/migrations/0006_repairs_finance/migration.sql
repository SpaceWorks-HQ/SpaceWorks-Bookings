-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('REPORTED', 'ASSIGNED', 'FIXED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TechnicianKind" AS ENUM ('STAFF', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TechnicianChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "RepairRequestStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "FinanceMethod" AS ENUM ('GATEWAY_RAZORPAY', 'GATEWAY_STRIPE', 'CASH', 'BANK_TRANSFER', 'UPI', 'OTHER');

-- CreateEnum
CREATE TYPE "FinanceCategory" AS ENUM ('BOOKING_PAYMENT', 'OTHER_PAYMENT', 'REFUND', 'REPAIR_PAYOUT', 'RENT', 'UTILITIES', 'SUPPLIES', 'STAFF_COSTS', 'OTHER_INCOME', 'OTHER_EXPENSE');

-- AlterEnum
ALTER TYPE "TeamRole" ADD VALUE 'TECHNICIAN';

-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "kind" "TechnicianKind" NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "telegramChatId" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredChannel" "TechnicianChannel" NOT NULL DEFAULT 'EMAIL',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Technician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceIssue" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "severity" "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IssueStatus" NOT NULL DEFAULT 'REPORTED',
    "reporterKind" TEXT NOT NULL,
    "reportedById" TEXT,
    "bookingId" TEXT,
    "technicianId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "fixRemarks" TEXT NOT NULL DEFAULT '',
    "partsUsed" TEXT NOT NULL DEFAULT '',
    "amountAskedMinor" INTEGER,
    "currency" TEXT NOT NULL,
    "fixedAt" TIMESTAMP(3),
    "approvedMinor" INTEGER,
    "approvedById" TEXT,
    "approvalNote" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "blackoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuePhoto" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairRequest" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "status" "RepairRequestStatus" NOT NULL DEFAULT 'SENT',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "RepairRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueEvent" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "technicianId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairPayout" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "technicianId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PayoutMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "direction" "FinanceDirection" NOT NULL,
    "category" "FinanceCategory" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "FinanceMethod" NOT NULL,
    "reference" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "spaceId" TEXT,
    "bookingId" TEXT,
    "issueId" TEXT,
    "technicianId" TEXT,
    "reversesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Technician_makerspaceId_active_idx" ON "Technician"("makerspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_makerspaceId_id_key" ON "Technician"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_makerspaceId_userId_key" ON "Technician"("makerspaceId", "userId");

-- CreateIndex
CREATE INDEX "SpaceIssue_makerspaceId_status_createdAt_idx" ON "SpaceIssue"("makerspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SpaceIssue_makerspaceId_spaceId_idx" ON "SpaceIssue"("makerspaceId", "spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceIssue_makerspaceId_id_key" ON "SpaceIssue"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceIssue_makerspaceId_reference_key" ON "SpaceIssue"("makerspaceId", "reference");

-- CreateIndex
CREATE INDEX "IssuePhoto_issueId_createdAt_idx" ON "IssuePhoto"("issueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepairRequest_tokenHash_key" ON "RepairRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "RepairRequest_status_expiresAt_idx" ON "RepairRequest"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepairRequest_makerspaceId_id_key" ON "RepairRequest"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RepairRequest_issueId_technicianId_key" ON "RepairRequest"("issueId", "technicianId");

-- CreateIndex
CREATE INDEX "IssueEvent_issueId_createdAt_idx" ON "IssueEvent"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueEvent_makerspaceId_createdAt_idx" ON "IssueEvent"("makerspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairPayout_makerspaceId_paidAt_idx" ON "RepairPayout"("makerspaceId", "paidAt");

-- CreateIndex
CREATE INDEX "RepairPayout_issueId_idx" ON "RepairPayout"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEntry_reversesId_key" ON "FinanceEntry"("reversesId");

-- CreateIndex
CREATE INDEX "FinanceEntry_makerspaceId_occurredAt_idx" ON "FinanceEntry"("makerspaceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceEntry_sourceType_sourceId_key" ON "FinanceEntry"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "Technician" ADD CONSTRAINT "Technician_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceIssue" ADD CONSTRAINT "SpaceIssue_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceIssue" ADD CONSTRAINT "SpaceIssue_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceIssue" ADD CONSTRAINT "SpaceIssue_makerspaceId_technicianId_fkey" FOREIGN KEY ("makerspaceId", "technicianId") REFERENCES "Technician"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuePhoto" ADD CONSTRAINT "IssuePhoto_makerspaceId_issueId_fkey" FOREIGN KEY ("makerspaceId", "issueId") REFERENCES "SpaceIssue"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairRequest" ADD CONSTRAINT "RepairRequest_makerspaceId_issueId_fkey" FOREIGN KEY ("makerspaceId", "issueId") REFERENCES "SpaceIssue"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairRequest" ADD CONSTRAINT "RepairRequest_makerspaceId_technicianId_fkey" FOREIGN KEY ("makerspaceId", "technicianId") REFERENCES "Technician"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_makerspaceId_issueId_fkey" FOREIGN KEY ("makerspaceId", "issueId") REFERENCES "SpaceIssue"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPayout" ADD CONSTRAINT "RepairPayout_makerspaceId_issueId_fkey" FOREIGN KEY ("makerspaceId", "issueId") REFERENCES "SpaceIssue"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPayout" ADD CONSTRAINT "RepairPayout_makerspaceId_technicianId_fkey" FOREIGN KEY ("makerspaceId", "technicianId") REFERENCES "Technician"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceEntry" ADD CONSTRAINT "FinanceEntry_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written: checks, the append-only ledger and its posting triggers, the backfill ─────────────────────

ALTER TABLE "SpaceIssue"
  ADD CONSTRAINT "SpaceIssue_reporter_kind" CHECK ("reporterKind" IN ('STAFF', 'CUSTOMER')),
  ADD CONSTRAINT "SpaceIssue_amounts" CHECK (coalesce("amountAskedMinor", 0) >= 0 AND coalesce("approvedMinor", 0) >= 0),
  ADD CONSTRAINT "SpaceIssue_title_length" CHECK (char_length("title") BETWEEN 1 AND 120);
ALTER TABLE "IssuePhoto" ADD CONSTRAINT "IssuePhoto_added_by" CHECK ("addedBy" IN ('STAFF', 'CUSTOMER', 'TECHNICIAN'));
ALTER TABLE "Technician"
  ADD CONSTRAINT "Technician_staff_user" CHECK (("kind" = 'STAFF') = ("userId" IS NOT NULL)),
  ADD CONSTRAINT "Technician_name_length" CHECK (char_length("name") BETWEEN 1 AND 120);
ALTER TABLE "RepairPayout"
  ADD CONSTRAINT "RepairPayout_amount" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "RepairPayout_reference" CHECK ("method" = 'CASH' OR char_length(btrim(coalesce("reference", ''))) > 0);
ALTER TABLE "FinanceEntry"
  ADD CONSTRAINT "FinanceEntry_amount" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "FinanceEntry_source_type" CHECK ("sourceType" IN ('PAYMENT', 'REFUND', 'REPAIR_PAYOUT', 'MANUAL', 'REVERSAL')),
  ADD CONSTRAINT "FinanceEntry_reversal" CHECK (("sourceType" = 'REVERSAL') = ("reversesId" IS NOT NULL));

-- The chat events list matches lib/chat/events.ts CHAT_EVENTS.
ALTER TABLE "ChatChannel" DROP CONSTRAINT "ChatChannel_events_known";
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_events_known"
  CHECK ("events" <@ ARRAY['payment', 'payment-to-confirm', 'issue-reported', 'issue-assigned', 'issue-resolved', 'repair-payment']::text[]);

-- Ledger rows and payouts are never changed or deleted: corrections are reversing entries.
CREATE FUNCTION finance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed or deleted; post a reversing entry instead', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER finance_entry_append_only BEFORE UPDATE OR DELETE ON "FinanceEntry" FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER repair_payout_append_only BEFORE UPDATE OR DELETE ON "RepairPayout" FOR EACH ROW EXECUTE FUNCTION finance_append_only();

CREATE FUNCTION finance_method(provider text, method text) RETURNS "FinanceMethod" LANGUAGE sql IMMUTABLE AS $$
  SELECT (CASE
    WHEN provider = 'RAZORPAY' THEN 'GATEWAY_RAZORPAY'
    WHEN provider = 'STRIPE' THEN 'GATEWAY_STRIPE'
    WHEN lower(coalesce(method, '')) = 'cash' THEN 'CASH'
    WHEN lower(coalesce(method, '')) = 'upi' THEN 'UPI'
    WHEN lower(coalesce(method, '')) = 'bank_transfer' THEN 'BANK_TRANSFER'
    ELSE 'OTHER' END)::"FinanceMethod"
$$;

-- Money in: a payment posts once, when it becomes PAID (whatever path settled it).
CREATE FUNCTION finance_post_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'PAID' AND coalesce(NEW."capturedMinor", NEW."amountMinor") > 0 AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'PAID') THEN
    INSERT INTO "FinanceEntry" ("id", "makerspaceId", "direction", "category", "amountMinor", "currency", "method", "reference", "occurredAt", "sourceType", "sourceId", "actorUserId", "spaceId", "bookingId")
    SELECT gen_random_uuid()::text, NEW."makerspaceId", 'IN', (CASE WHEN NEW."bookingId" IS NULL THEN 'OTHER_PAYMENT' ELSE 'BOOKING_PAYMENT' END)::"FinanceCategory",
      coalesce(NEW."capturedMinor", NEW."amountMinor"), NEW."currency", finance_method(NEW."provider"::text, NEW."method"),
      coalesce(NEW."gatewayPaymentId", NEW."utr", NEW."reference"), coalesce(NEW."paidAt", now()), 'PAYMENT', NEW."id",
      coalesce(NEW."confirmedById", NEW."recordedById"), (SELECT b."spaceId" FROM "Booking" b WHERE b."id" = NEW."bookingId"), NEW."bookingId"
    ON CONFLICT ("sourceType", "sourceId") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER payment_finance_entry AFTER INSERT OR UPDATE OF "status" ON "Payment" FOR EACH ROW EXECUTE FUNCTION finance_post_payment();

-- Money out: a refund posts once, when it is PROCESSED (gateway or handed back offline).
CREATE FUNCTION finance_post_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'PROCESSED' AND NEW."amountMinor" > 0 AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'PROCESSED') THEN
    INSERT INTO "FinanceEntry" ("id", "makerspaceId", "direction", "category", "amountMinor", "currency", "method", "reference", "occurredAt", "sourceType", "sourceId", "actorUserId", "spaceId", "bookingId")
    SELECT gen_random_uuid()::text, NEW."makerspaceId", 'OUT', 'REFUND', NEW."amountMinor", NEW."currency",
      CASE WHEN NEW."offlineRequired" OR p."provider" = 'OFFLINE' THEN finance_method('OFFLINE', coalesce(NEW."method", p."method")) ELSE finance_method(p."provider"::text, NULL) END,
      coalesce(NEW."gatewayRefundId", NEW."reference"), coalesce(NEW."processedAt", now()), 'REFUND', NEW."id", NEW."createdById",
      (SELECT b."spaceId" FROM "Booking" b WHERE b."id" = p."bookingId"), p."bookingId"
    FROM "Payment" p WHERE p."id" = NEW."paymentId"
    ON CONFLICT ("sourceType", "sourceId") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER refund_finance_entry AFTER INSERT OR UPDATE OF "status" ON "Refund" FOR EACH ROW EXECUTE FUNCTION finance_post_refund();

-- Money out: every repair payout.
CREATE FUNCTION finance_post_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "FinanceEntry" ("id", "makerspaceId", "direction", "category", "amountMinor", "currency", "method", "reference", "occurredAt", "sourceType", "sourceId", "actorUserId", "note", "spaceId", "issueId", "technicianId")
  SELECT gen_random_uuid()::text, NEW."makerspaceId", 'OUT', 'REPAIR_PAYOUT', NEW."amountMinor", NEW."currency", finance_method('OFFLINE', lower(NEW."method"::text)),
    NEW."reference", NEW."paidAt", 'REPAIR_PAYOUT', NEW."id", NEW."paidById", NEW."note", i."spaceId", NEW."issueId", NEW."technicianId"
  FROM "SpaceIssue" i WHERE i."id" = NEW."issueId";
  RETURN NULL;
END $$;
CREATE TRIGGER repair_payout_finance_entry AFTER INSERT ON "RepairPayout" FOR EACH ROW EXECUTE FUNCTION finance_post_payout();

-- Backfill: history already paid and refunded appears in the ledger.
INSERT INTO "FinanceEntry" ("id", "makerspaceId", "direction", "category", "amountMinor", "currency", "method", "reference", "occurredAt", "sourceType", "sourceId", "actorUserId", "spaceId", "bookingId", "createdAt")
SELECT gen_random_uuid()::text, p."makerspaceId", 'IN', (CASE WHEN p."bookingId" IS NULL THEN 'OTHER_PAYMENT' ELSE 'BOOKING_PAYMENT' END)::"FinanceCategory",
  coalesce(p."capturedMinor", p."amountMinor"), p."currency", finance_method(p."provider"::text, p."method"),
  coalesce(p."gatewayPaymentId", p."utr", p."reference"), coalesce(p."paidAt", p."updatedAt"), 'PAYMENT', p."id",
  coalesce(p."confirmedById", p."recordedById"), b."spaceId", p."bookingId", coalesce(p."paidAt", p."updatedAt")
FROM "Payment" p LEFT JOIN "Booking" b ON b."id" = p."bookingId"
WHERE p."status" = 'PAID' AND coalesce(p."capturedMinor", p."amountMinor") > 0
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

INSERT INTO "FinanceEntry" ("id", "makerspaceId", "direction", "category", "amountMinor", "currency", "method", "reference", "occurredAt", "sourceType", "sourceId", "actorUserId", "spaceId", "bookingId", "createdAt")
SELECT gen_random_uuid()::text, r."makerspaceId", 'OUT', 'REFUND', r."amountMinor", r."currency",
  CASE WHEN r."offlineRequired" OR p."provider" = 'OFFLINE' THEN finance_method('OFFLINE', coalesce(r."method", p."method")) ELSE finance_method(p."provider"::text, NULL) END,
  coalesce(r."gatewayRefundId", r."reference"), coalesce(r."processedAt", r."createdAt"), 'REFUND', r."id", r."createdById", b."spaceId", p."bookingId", coalesce(r."processedAt", r."createdAt")
FROM "Refund" r JOIN "Payment" p ON p."id" = r."paymentId" LEFT JOIN "Booking" b ON b."id" = p."bookingId"
WHERE r."status" = 'PROCESSED' AND r."amountMinor" > 0
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

-- History is not news: the finance and issue webhook relays start from now, so backfilled entries are never sent.
INSERT INTO "WebhookRelayCursor" ("id", "createdAt", "eventId") VALUES ('finance-entries', now(), ''), ('issue-events', now(), '') ON CONFLICT ("id") DO NOTHING;
