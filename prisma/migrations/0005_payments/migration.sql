-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('NONE', 'RAZORPAY', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AWAITING_CONFIRMATION', 'PAID', 'WAIVED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentLineKind" AS ENUM ('TERM_FEE', 'JOINING_FEE', 'REJOIN_FEE');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('GST', 'SIMPLE', 'NONE');

-- CreateEnum
CREATE TYPE "GstScheme" AS ENUM ('REGULAR', 'COMPOSITION');

-- CreateEnum
CREATE TYPE "ForeignCurrencyTax" AS ENUM ('EXPORT_LUT', 'NO_TAX');

-- CreateEnum
CREATE TYPE "TaxDocumentKind" AS ENUM ('RECEIPT', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'CREDIT_NOTE');

-- CreateTable
CREATE TABLE "OrgPaymentSettings" (
    "organisationId" TEXT NOT NULL,
    "provider" "GatewayProvider" NOT NULL DEFAULT 'NONE',
    "keyId" TEXT,
    "secretEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "webhookPublicCode" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "upiVpa" TEXT,
    "upiPayeeName" TEXT,
    "offlineInstructions" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPaymentSettings_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "OrgTaxSettings" (
    "organisationId" TEXT NOT NULL,
    "mode" "TaxMode" NOT NULL DEFAULT 'NONE',
    "scheme" "GstScheme" NOT NULL DEFAULT 'REGULAR',
    "gstin" TEXT,
    "legalName" TEXT,
    "address" TEXT,
    "stateCode" TEXT,
    "sacCode" TEXT NOT NULL DEFAULT '999599',
    "rateBps" INTEGER NOT NULL DEFAULT 1800,
    "inclusive" BOOLEAN NOT NULL DEFAULT true,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "foreignCurrencyTax" "ForeignCurrencyTax" NOT NULL DEFAULT 'NO_TAX',
    "lutNumber" TEXT,
    "simpleTaxName" TEXT NOT NULL DEFAULT 'Tax',
    "receiptPrefix" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgTaxSettings_pkey" PRIMARY KEY ("organisationId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "termId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL,
    "method" TEXT,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "settlementId" TEXT,
    "utr" TEXT,
    "reference" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "confirmedById" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "flagReason" TEXT,
    "documentHeld" BOOLEAN NOT NULL DEFAULT false,
    "capturedMinor" INTEGER,
    "taxSnapshot" JSONB NOT NULL,
    "anonymisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLine" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "kind" "PaymentLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "taxableMinor" INTEGER NOT NULL,
    "cgstMinor" INTEGER NOT NULL DEFAULT 0,
    "sgstMinor" INTEGER NOT NULL DEFAULT 0,
    "igstMinor" INTEGER NOT NULL DEFAULT 0,
    "otherTaxMinor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhookEvent" (
    "provider" "PaymentProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("provider","eventId")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "gatewayRefundId" TEXT,
    "createdById" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "refundId" TEXT,
    "kind" "TaxDocumentKind" NOT NULL,
    "series" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "taxableMinor" INTEGER NOT NULL,
    "cgstMinor" INTEGER NOT NULL DEFAULT 0,
    "sgstMinor" INTEGER NOT NULL DEFAULT 0,
    "igstMinor" INTEGER NOT NULL DEFAULT 0,
    "otherTaxMinor" INTEGER NOT NULL DEFAULT 0,
    "placeOfSupply" TEXT,
    "sac" TEXT,
    "snapshot" JSONB NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "TaxDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "organisationId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("organisationId","series","financialYear")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgPaymentSettings_webhookPublicCode_key" ON "OrgPaymentSettings"("webhookPublicCode");

-- CreateIndex
CREATE INDEX "Payment_organisationId_status_createdAt_idx" ON "Payment"("organisationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_organisationId_paidAt_idx" ON "Payment"("organisationId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_organisationId_memberId_idx" ON "Payment"("organisationId", "memberId");

-- CreateIndex
CREATE INDEX "Payment_termId_idx" ON "Payment"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organisationId_id_key" ON "Payment"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_gatewayOrderId_key" ON "Payment"("provider", "gatewayOrderId");

-- CreateIndex
CREATE INDEX "PaymentLine_paymentId_idx" ON "PaymentLine"("paymentId");

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_organisationId_receivedAt_idx" ON "ProcessedWebhookEvent"("organisationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");

-- CreateIndex
CREATE INDEX "Refund_organisationId_createdAt_idx" ON "Refund"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_organisationId_id_key" ON "Refund"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_refundId_key" ON "TaxDocument"("refundId");

-- CreateIndex
CREATE INDEX "TaxDocument_organisationId_issuedAt_idx" ON "TaxDocument"("organisationId", "issuedAt");

-- CreateIndex
CREATE INDEX "TaxDocument_paymentId_idx" ON "TaxDocument"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_organisationId_number_key" ON "TaxDocument"("organisationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_organisationId_series_financialYear_sequence_key" ON "TaxDocument"("organisationId", "series", "financialYear", "sequence");

-- AddForeignKey
ALTER TABLE "OrgPaymentSettings" ADD CONSTRAINT "OrgPaymentSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgTaxSettings" ADD CONSTRAINT "OrgTaxSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organisationId_memberId_fkey" FOREIGN KEY ("organisationId", "memberId") REFERENCES "Member"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organisationId_termId_fkey" FOREIGN KEY ("organisationId", "termId") REFERENCES "MembershipTerm"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_organisationId_paymentId_fkey" FOREIGN KEY ("organisationId", "paymentId") REFERENCES "Payment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organisationId_paymentId_fkey" FOREIGN KEY ("organisationId", "paymentId") REFERENCES "Payment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_organisationId_paymentId_fkey" FOREIGN KEY ("organisationId", "paymentId") REFERENCES "Payment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written constraints (P7) ──────────────────────────────────────────

ALTER TABLE "OrgTaxSettings"
  ADD CONSTRAINT "OrgTaxSettings_rate_range" CHECK ("rateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "OrgTaxSettings_prefix_format" CHECK ("receiptPrefix" ~ '^[A-Z0-9]{0,4}$'),
  ADD CONSTRAINT "OrgTaxSettings_sac_format" CHECK ("sacCode" ~ '^[0-9]{4,8}$'),
  ADD CONSTRAINT "OrgTaxSettings_gst_ready" CHECK ("mode" <> 'GST' OR ("gstin" IS NOT NULL AND "legalName" IS NOT NULL AND "stateCode" IS NOT NULL));

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_nonnegative" CHECK ("amountMinor" >= 0 AND ("capturedMinor" IS NULL OR "capturedMinor" >= 0)),
  ADD CONSTRAINT "Payment_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Payment_paid_has_date" CHECK ("status" NOT IN ('PAID', 'WAIVED') OR "paidAt" IS NOT NULL),
  ADD CONSTRAINT "Payment_offline_has_no_gateway" CHECK ("provider" <> 'OFFLINE' OR "gatewayOrderId" IS NULL);

-- A UPI or bank reference is claimed once per organisation, but a rejected claim can be resubmitted.
CREATE UNIQUE INDEX "Payment_offline_utr_once" ON "Payment" ("organisationId", "utr")
  WHERE "provider" = 'OFFLINE' AND "utr" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'FAILED');

-- At most one open payment per term; a new checkout cancels the previous one first.
CREATE UNIQUE INDEX "Payment_one_open_per_term" ON "Payment" ("termId")
  WHERE "termId" IS NOT NULL AND "status" IN ('PENDING', 'AWAITING_CONFIRMATION');

ALTER TABLE "PaymentLine"
  ADD CONSTRAINT "PaymentLine_amounts" CHECK (
    "amountMinor" >= 0 AND "taxableMinor" >= 0 AND "cgstMinor" >= 0 AND "sgstMinor" >= 0 AND "igstMinor" >= 0 AND "otherTaxMinor" >= 0
    AND "amountMinor" = "taxableMinor" + "cgstMinor" + "sgstMinor" + "igstMinor" + "otherTaxMinor"
  );

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "Refund_processed_has_date" CHECK ("status" <> 'PROCESSED' OR "processedAt" IS NOT NULL);

ALTER TABLE "TaxDocument"
  ADD CONSTRAINT "TaxDocument_series" CHECK ("series" IN ('R', 'C')),
  ADD CONSTRAINT "TaxDocument_kind_series" CHECK (("kind" = 'CREDIT_NOTE') = ("series" = 'C')),
  ADD CONSTRAINT "TaxDocument_credit_note_link" CHECK ("kind" <> 'CREDIT_NOTE' OR "refundId" IS NOT NULL),
  ADD CONSTRAINT "TaxDocument_number_length" CHECK (char_length("number") BETWEEN 1 AND 16),
  ADD CONSTRAINT "TaxDocument_sequence_positive" CHECK ("sequence" > 0),
  ADD CONSTRAINT "TaxDocument_fy_format" CHECK ("financialYear" ~ '^[0-9]{4}(-[0-9]{2})?$');

-- One payment document per payment (credit notes hang off refunds).
CREATE UNIQUE INDEX "TaxDocument_one_per_payment" ON "TaxDocument" ("paymentId") WHERE "kind" <> 'CREDIT_NOTE';

ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_next_positive" CHECK ("next" > 0);

-- ── Immutability (column allowlists, not whole-row freezes) ────────────────

CREATE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('PAID', 'WAIVED') THEN
      RAISE EXCEPTION 'A paid payment is never deleted; refund it with a credit note' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('PAID', 'WAIVED') THEN
    IF NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
      OR NEW."memberId" IS DISTINCT FROM OLD."memberId"
      OR NEW."termId" IS DISTINCT FROM OLD."termId"
      OR NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."provider" IS DISTINCT FROM OLD."provider"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
      OR NEW."capturedMinor" IS DISTINCT FROM OLD."capturedMinor"
      OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
      OR NEW."gatewayOrderId" IS DISTINCT FROM OLD."gatewayOrderId"
      OR NEW."taxSnapshot"::text IS DISTINCT FROM OLD."taxSnapshot"::text
      OR (OLD."gatewayPaymentId" IS NOT NULL AND NEW."gatewayPaymentId" IS DISTINCT FROM OLD."gatewayPaymentId")
      OR (OLD."utr" IS NOT NULL AND OLD."anonymisedAt" IS NULL AND NEW."anonymisedAt" IS NULL AND NEW."utr" IS DISTINCT FROM OLD."utr")
    THEN
      RAISE EXCEPTION 'A paid payment can only gain settlement details, review flags or anonymisation' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Payment_guard" BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION payment_guard();

CREATE FUNCTION payment_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lines of a payment that never settled may go with it (an unpaid organisation being deleted).
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "Payment" WHERE "id" = OLD."paymentId" AND "status" IN ('PAID', 'WAIVED')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Payment lines are written once' USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER "PaymentLine_guard" BEFORE UPDATE OR DELETE ON "PaymentLine" FOR EACH ROW EXECUTE FUNCTION payment_line_guard();

CREATE FUNCTION tax_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tax documents are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL
    OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."refundId" IS DISTINCT FROM OLD."refundId"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."series" IS DISTINCT FROM OLD."series"
    OR NEW."financialYear" IS DISTINCT FROM OLD."financialYear"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."totalMinor" IS DISTINCT FROM OLD."totalMinor"
    OR NEW."taxableMinor" IS DISTINCT FROM OLD."taxableMinor"
    OR NEW."cgstMinor" IS DISTINCT FROM OLD."cgstMinor"
    OR NEW."sgstMinor" IS DISTINCT FROM OLD."sgstMinor"
    OR NEW."igstMinor" IS DISTINCT FROM OLD."igstMinor"
    OR NEW."otherTaxMinor" IS DISTINCT FROM OLD."otherTaxMinor"
    OR NEW."placeOfSupply" IS DISTINCT FROM OLD."placeOfSupply"
    OR NEW."sac" IS DISTINCT FROM OLD."sac"
    OR NEW."snapshot"::text IS DISTINCT FROM OLD."snapshot"::text
    OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion"
    OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
  THEN
    RAISE EXCEPTION 'A tax document can only be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "TaxDocument_guard" BEFORE UPDATE OR DELETE ON "TaxDocument" FOR EACH ROW EXECUTE FUNCTION tax_document_guard();

CREATE FUNCTION refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refunds are never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'PENDING'
    OR NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
  THEN
    RAISE EXCEPTION 'A refund can only move on from pending' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Refund_guard" BEFORE UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION refund_guard();
