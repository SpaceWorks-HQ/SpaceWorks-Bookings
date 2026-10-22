-- CreateEnum
CREATE TYPE "RefundPolicy" AS ENUM ('NONE', 'FULL', 'PRO_RATA');

-- CreateEnum
CREATE TYPE "RefundRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "OrgPaymentSettings" ADD COLUMN     "refundPolicy" "RefundPolicy" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "refundPolicyText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "refundWindowDays" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'OPEN',
    "suggestedMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_refundId_key" ON "RefundRequest"("refundId");

-- CreateIndex
CREATE INDEX "RefundRequest_organisationId_status_createdAt_idx" ON "RefundRequest"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RefundRequest_paymentId_idx" ON "RefundRequest"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_organisationId_id_key" ON "RefundRequest"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_organisationId_paymentId_fkey" FOREIGN KEY ("organisationId", "paymentId") REFERENCES "Payment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_organisationId_termId_fkey" FOREIGN KEY ("organisationId", "termId") REFERENCES "MembershipTerm"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_organisationId_memberId_fkey" FOREIGN KEY ("organisationId", "memberId") REFERENCES "Member"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written rules (not expressible in the Prisma schema).
ALTER TABLE "OrgPaymentSettings"
  ADD CONSTRAINT "OrgPaymentSettings_refund_window" CHECK ("refundWindowDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "OrgPaymentSettings_refund_text_length" CHECK (char_length("refundPolicyText") <= 2000);

ALTER TABLE "RefundRequest"
  ADD CONSTRAINT "RefundRequest_suggested_not_negative" CHECK ("suggestedMinor" >= 0),
  ADD CONSTRAINT "RefundRequest_reason_length" CHECK (char_length("reason") BETWEEN 1 AND 500),
  ADD CONSTRAINT "RefundRequest_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "RefundRequest_decided" CHECK (("status" = 'OPEN') = ("decidedAt" IS NULL)),
  ADD CONSTRAINT "RefundRequest_approved_has_refund" CHECK ("status" <> 'APPROVED' OR "refundId" IS NOT NULL);

-- One open request per payment; decided ones stay as history.
CREATE UNIQUE INDEX "RefundRequest_one_open_per_payment" ON "RefundRequest"("paymentId") WHERE "status" = 'OPEN';

-- Requests are never deleted, and a decided request never changes again (erasure may only blank the reason).
CREATE FUNCTION refund_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refund requests are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."termId" IS DISTINCT FROM OLD."termId"
    OR NEW."memberId" IS DISTINCT FROM OLD."memberId"
    OR NEW."suggestedMinor" IS DISTINCT FROM OLD."suggestedMinor"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR (OLD."status" <> 'OPEN' AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."decidedById" IS DISTINCT FROM OLD."decidedById"
      OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
      OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote"
      OR NEW."refundId" IS DISTINCT FROM OLD."refundId"))
  THEN
    RAISE EXCEPTION 'A refund request can only be decided once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "RefundRequest_guard" BEFORE UPDATE OR DELETE ON "RefundRequest" FOR EACH ROW EXECUTE FUNCTION refund_request_guard();
