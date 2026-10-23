-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('FULL', 'DEPOSIT', 'BALANCE', 'DIFFERENCE');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('POLICY', 'VENUE', 'MANUAL', 'RESCHEDULE', 'DUPLICATE', 'LATE_CAPTURE', 'EXTERNAL');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "concessionMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "paymentReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "purpose" "PaymentPurpose";

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "flagReason" TEXT,
ADD COLUMN     "flaggedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "RefundKind" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "method" TEXT,
ADD COLUMN     "offlineRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "refundGroupId" TEXT,
ADD COLUMN     "retryOfId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GatewayRefundNotice" (
    "provider" "PaymentProvider" NOT NULL,
    "gatewayRefundId" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "GatewayRefundNotice_pkey" PRIMARY KEY ("provider","gatewayRefundId")
);

-- CreateIndex
CREATE INDEX "GatewayRefundNotice_resolvedAt_receivedAt_idx" ON "GatewayRefundNotice"("resolvedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_retryOfId_key" ON "Refund"("retryOfId");

-- CreateIndex
CREATE INDEX "Refund_status_sentAt_idx" ON "Refund"("status", "sentAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_retryOfId_fkey" FOREIGN KEY ("retryOfId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written below: guards and the booking money caches (docs/PAYMENTS.md "Booking money").

CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('PAID', 'WAIVED') THEN
      RAISE EXCEPTION 'A paid payment is never deleted; refund it with a credit note' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('PAID', 'WAIVED') THEN
    IF NEW."makerspaceId" IS DISTINCT FROM OLD."makerspaceId"
      OR (OLD."bookingId" IS NOT NULL AND NEW."bookingId" IS DISTINCT FROM OLD."bookingId")
      OR NEW."customerName" IS DISTINCT FROM OLD."customerName"
      OR NEW."customerEmail" IS DISTINCT FROM OLD."customerEmail"
      OR NEW."customerStateCode" IS DISTINCT FROM OLD."customerStateCode"
      OR NEW."customerGstin" IS DISTINCT FROM OLD."customerGstin"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."provider" IS DISTINCT FROM OLD."provider"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR (OLD."purpose" IS NOT NULL AND NEW."purpose" IS DISTINCT FROM OLD."purpose")
      OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
      OR NEW."capturedMinor" IS DISTINCT FROM OLD."capturedMinor"
      OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
      OR NEW."gatewayOrderId" IS DISTINCT FROM OLD."gatewayOrderId"
      OR NEW."taxSnapshot"::text IS DISTINCT FROM OLD."taxSnapshot"::text
      OR (OLD."gatewayPaymentId" IS NOT NULL AND NEW."gatewayPaymentId" IS DISTINCT FROM OLD."gatewayPaymentId")
      OR (OLD."utr" IS NOT NULL AND NEW."utr" IS DISTINCT FROM OLD."utr")
    THEN
      RAISE EXCEPTION 'A paid payment can only gain settlement details or review flags' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- A refund's amount, payment and reasons are fixed; once it leaves PENDING only review flags, the send claim and
-- the last check time may change.
CREATE OR REPLACE FUNCTION refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refunds are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."makerspaceId" IS DISTINCT FROM OLD."makerspaceId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."refundGroupId" IS DISTINCT FROM OLD."refundGroupId"
    OR NEW."retryOfId" IS DISTINCT FROM OLD."retryOfId"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR (OLD."status" <> 'PENDING' AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."processedAt" IS DISTINCT FROM OLD."processedAt"
      OR NEW."gatewayRefundId" IS DISTINCT FROM OLD."gatewayRefundId"
      OR NEW."failureReason" IS DISTINCT FROM OLD."failureReason"
      OR NEW."method" IS DISTINCT FROM OLD."method"
      OR NEW."reference" IS DISTINCT FROM OLD."reference"
      OR NEW."offlineRequired" IS DISTINCT FROM OLD."offlineRequired"
      OR NEW."reason" IS DISTINCT FROM OLD."reason"))
  THEN
    RAISE EXCEPTION 'A refund can only move on from pending' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- A payment's booking belongs to the same makerspace.
CREATE FUNCTION payment_booking_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bookingId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Booking" WHERE "id" = NEW."bookingId" AND "makerspaceId" = NEW."makerspaceId") THEN
    RAISE EXCEPTION 'A payment belongs to a booking of its own makerspace' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Payment_booking_tenant" BEFORE INSERT OR UPDATE OF "bookingId", "makerspaceId" ON "Payment" FOR EACH ROW EXECUTE FUNCTION payment_booking_tenant();

-- Booking.paidMinor and refundedMinor are caches of the PAID payments and PROCESSED refunds of the booking. Only
-- booking_money_refresh writes them (Booking_money_guard refuses any other writer).
CREATE FUNCTION booking_money_refresh(target TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF target IS NULL THEN RETURN; END IF;
  PERFORM set_config('swb.money_refresh', 'on', true);
  UPDATE "Booking" SET
    "paidMinor" = COALESCE((SELECT SUM(COALESCE(p."capturedMinor", p."amountMinor")) FROM "Payment" p WHERE p."bookingId" = target AND p."status" = 'PAID'), 0),
    "refundedMinor" = COALESCE((SELECT SUM(r."amountMinor") FROM "Refund" r JOIN "Payment" p ON p."id" = r."paymentId" WHERE p."bookingId" = target AND r."status" = 'PROCESSED'), 0)
  WHERE "id" = target;
  PERFORM set_config('swb.money_refresh', 'off', true);
END $$;

CREATE FUNCTION booking_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."paidMinor" IS DISTINCT FROM OLD."paidMinor" OR NEW."refundedMinor" IS DISTINCT FROM OLD."refundedMinor")
    AND COALESCE(current_setting('swb.money_refresh', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Booking money caches are maintained by triggers' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Booking_money_guard" BEFORE UPDATE OF "paidMinor", "refundedMinor" ON "Booking" FOR EACH ROW EXECUTE FUNCTION booking_money_guard();

CREATE FUNCTION payment_money_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'PAID' THEN PERFORM booking_money_refresh(NEW."bookingId"); END IF;
    RETURN NULL;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" OR NEW."capturedMinor" IS DISTINCT FROM OLD."capturedMinor"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId" THEN
    PERFORM booking_money_refresh(NEW."bookingId");
    IF OLD."bookingId" IS DISTINCT FROM NEW."bookingId" THEN PERFORM booking_money_refresh(OLD."bookingId"); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "Payment_money_cache" AFTER INSERT OR UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION payment_money_cache();

CREATE FUNCTION refund_money_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW."status" = 'PROCESSED') OR (TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status") THEN
    PERFORM booking_money_refresh((SELECT "bookingId" FROM "Payment" WHERE "id" = NEW."paymentId"));
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "Refund_money_cache" AFTER INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION refund_money_cache();

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_concession_check" CHECK ("concessionMinor" >= 0);

-- Existing rows: bring the caches in line once.
DO $$
DECLARE target TEXT;
BEGIN
  FOR target IN SELECT DISTINCT "bookingId" FROM "Payment" WHERE "bookingId" IS NOT NULL LOOP
    PERFORM booking_money_refresh(target);
  END LOOP;
END $$;
