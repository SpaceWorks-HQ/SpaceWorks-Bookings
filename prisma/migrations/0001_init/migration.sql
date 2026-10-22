-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'SPACE_MANAGER', 'BOOKINGS_MANAGER', 'FRONT_DESK', 'TREASURER', 'VIEWER');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MakerspaceStatus" AS ENUM ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MakerspaceSource" AS ENUM ('SELF_SIGNUP', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "MakerspaceVisibility" AS ENUM ('UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MakerspaceReviewAction" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'REACTIVATED', 'ARCHIVED', 'CREATED');

-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('NONE', 'RAZORPAY', 'STRIPE');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AWAITING_CONFIRMATION', 'PAID', 'WAIVED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentLineKind" AS ENUM ('BOOKING', 'ADD_ON', 'OTHER');

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

-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('SLACK', 'DISCORD', 'MATTERMOST', 'TELEGRAM', 'WHATSAPP');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "profileImageUrl" TEXT,
    "passwordHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "mfaSecretEncrypted" TEXT,
    "mfaEnabledAt" TIMESTAMP(3),
    "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Makerspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT,
    "accentColor" TEXT,
    "status" "MakerspaceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "source" "MakerspaceSource" NOT NULL DEFAULT 'SELF_SIGNUP',
    "kind" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "stateCode" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "website" TEXT,
    "financialYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "managerLimit" INTEGER,
    "offlineConfirmationRequired" BOOLEAN NOT NULL DEFAULT false,
    "visibility" "MakerspaceVisibility" NOT NULL DEFAULT 'UNLISTED',
    "locale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Makerspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MakerspaceReview" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "action" "MakerspaceReviewAction" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "applicationSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MakerspaceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'VIEWER',
    "createdByUserId" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "makerspaceId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalHeartbeat" (
    "key" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastSent" INTEGER NOT NULL DEFAULT 0,
    "lastFailed" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalHeartbeat_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "InstanceSetting" (
    "id" TEXT NOT NULL,
    "allowNewUserSignups" BOOLEAN NOT NULL DEFAULT true,
    "allowMakerspaceApplications" BOOLEAN NOT NULL DEFAULT true,
    "emailFrom" TEXT,
    "smtpService" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "smtpPasswordEncrypted" TEXT,
    "smtpAllowUnauthenticated" BOOLEAN NOT NULL DEFAULT false,
    "backupProvider" TEXT,
    "backupLastSuccessAt" TIMESTAMP(3),
    "backupRetentionDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT,
    "key" TEXT NOT NULL,
    "publicUrl" TEXT,
    "contentType" TEXT,
    "byteSize" BIGINT,
    "provider" TEXT NOT NULL DEFAULT 'unknown',
    "fileData" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MakerspacePaymentSettings" (
    "makerspaceId" TEXT NOT NULL,
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

    CONSTRAINT "MakerspacePaymentSettings_pkey" PRIMARY KEY ("makerspaceId")
);

-- CreateTable
CREATE TABLE "MakerspaceTaxSettings" (
    "makerspaceId" TEXT NOT NULL,
    "mode" "TaxMode" NOT NULL DEFAULT 'NONE',
    "scheme" "GstScheme" NOT NULL DEFAULT 'REGULAR',
    "gstin" TEXT,
    "legalName" TEXT,
    "address" TEXT,
    "stateCode" TEXT,
    "sacCode" TEXT NOT NULL DEFAULT '997212',
    "rateBps" INTEGER NOT NULL DEFAULT 1800,
    "inclusive" BOOLEAN NOT NULL DEFAULT true,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "foreignCurrencyTax" "ForeignCurrencyTax" NOT NULL DEFAULT 'NO_TAX',
    "lutNumber" TEXT,
    "simpleTaxName" TEXT NOT NULL DEFAULT 'Tax',
    "receiptPrefix" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerspaceTaxSettings_pkey" PRIMARY KEY ("makerspaceId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "bookingId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerStateCode" TEXT,
    "customerGstin" TEXT,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLine" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
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
    "makerspaceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("provider","eventId")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
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
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDocument" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
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
    "makerspaceId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("makerspaceId","series","financialYear")
);

-- CreateTable
CREATE TABLE "MakerspaceEmailSettings" (
    "makerspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromAddress" TEXT,
    "replyTo" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "smtpPasswordEncrypted" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerspaceEmailSettings_pkey" PRIMARY KEY ("makerspaceId")
);

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "kind" "ChatChannelKind" NOT NULL,
    "name" TEXT NOT NULL,
    "configEncrypted" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "events" TEXT[],
    "includeNames" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "lastIp" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Makerspace_slug_key" ON "Makerspace"("slug");

-- CreateIndex
CREATE INDEX "Makerspace_status_createdAt_idx" ON "Makerspace"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Makerspace_visibility_status_idx" ON "Makerspace"("visibility", "status");

-- CreateIndex
CREATE INDEX "MakerspaceReview_makerspaceId_createdAt_idx" ON "MakerspaceReview"("makerspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MakerspaceReview_action_createdAt_idx" ON "MakerspaceReview"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_makerspaceId_idx" ON "TeamInvite"("makerspaceId");

-- CreateIndex
CREATE INDEX "TeamInvite_makerspaceId_createdAt_idx" ON "TeamInvite"("makerspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "TeamInvite_usedAt_idx" ON "TeamInvite"("usedAt");

-- CreateIndex
CREATE INDEX "TeamMember_makerspaceId_idx" ON "TeamMember"("makerspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_makerspaceId_key" ON "TeamMember"("userId", "makerspaceId");

-- CreateIndex
CREATE INDEX "AuditEvent_makerspaceId_createdAt_idx" ON "AuditEvent"("makerspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_idx" ON "OutboxMessage"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_createdAt_idx" ON "OutboxMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_key_key" ON "Asset"("key");

-- CreateIndex
CREATE INDEX "Asset_makerspaceId_idx" ON "Asset"("makerspaceId");

-- CreateIndex
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");

-- CreateIndex
CREATE INDEX "Asset_provider_idx" ON "Asset"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "MakerspacePaymentSettings_webhookPublicCode_key" ON "MakerspacePaymentSettings"("webhookPublicCode");

-- CreateIndex
CREATE INDEX "Payment_makerspaceId_status_createdAt_idx" ON "Payment"("makerspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_makerspaceId_paidAt_idx" ON "Payment"("makerspaceId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_makerspaceId_bookingId_idx" ON "Payment"("makerspaceId", "bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_makerspaceId_id_key" ON "Payment"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_gatewayOrderId_key" ON "Payment"("provider", "gatewayOrderId");

-- CreateIndex
CREATE INDEX "PaymentLine_paymentId_idx" ON "PaymentLine"("paymentId");

-- CreateIndex
CREATE INDEX "ProcessedWebhookEvent_makerspaceId_receivedAt_idx" ON "ProcessedWebhookEvent"("makerspaceId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");

-- CreateIndex
CREATE INDEX "Refund_makerspaceId_createdAt_idx" ON "Refund"("makerspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_makerspaceId_id_key" ON "Refund"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_refundId_key" ON "TaxDocument"("refundId");

-- CreateIndex
CREATE INDEX "TaxDocument_makerspaceId_issuedAt_idx" ON "TaxDocument"("makerspaceId", "issuedAt");

-- CreateIndex
CREATE INDEX "TaxDocument_paymentId_idx" ON "TaxDocument"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_makerspaceId_number_key" ON "TaxDocument"("makerspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TaxDocument_makerspaceId_series_financialYear_sequence_key" ON "TaxDocument"("makerspaceId", "series", "financialYear", "sequence");

-- CreateIndex
CREATE INDEX "ChatChannel_makerspaceId_idx" ON "ChatChannel"("makerspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_makerspaceId_id_key" ON "ChatChannel"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_tokenHash_key" ON "KnownDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KnownDevice_userId_lastSeenAt_idx" ON "KnownDevice"("userId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "MakerspaceReview" ADD CONSTRAINT "MakerspaceReview_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceReview" ADD CONSTRAINT "MakerspaceReview_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspacePaymentSettings" ADD CONSTRAINT "MakerspacePaymentSettings_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceTaxSettings" ADD CONSTRAINT "MakerspaceTaxSettings_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_makerspaceId_paymentId_fkey" FOREIGN KEY ("makerspaceId", "paymentId") REFERENCES "Payment"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_makerspaceId_paymentId_fkey" FOREIGN KEY ("makerspaceId", "paymentId") REFERENCES "Payment"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_makerspaceId_paymentId_fkey" FOREIGN KEY ("makerspaceId", "paymentId") REFERENCES "Payment"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceEmailSettings" ADD CONSTRAINT "MakerspaceEmailSettings_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Integrity rules Prisma cannot express ─────────────────────────────────
-- Application code enforces them too; these stop a bug or a manual edit from storing an impossible row.

ALTER TABLE "OutboxMessage"
  ADD CONSTRAINT "OutboxMessage_attempts_nonnegative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "OutboxMessage_state_shape" CHECK (
    ("status" = 'PROCESSING' AND "lockedAt" IS NOT NULL AND "sentAt" IS NULL)
    OR ("status" = 'SENT' AND "lockedAt" IS NULL AND "sentAt" IS NOT NULL)
    OR ("status" IN ('PENDING', 'FAILED') AND "lockedAt" IS NULL AND "sentAt" IS NULL)
  );

ALTER TABLE "TeamInvite"
  ADD CONSTRAINT "TeamInvite_usage_pair" CHECK ("usedByUserId" IS NULL OR "usedAt" IS NOT NULL);

ALTER TABLE "Makerspace"
  ADD CONSTRAINT "Makerspace_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "Makerspace_financial_year_month" CHECK ("financialYearStartMonth" BETWEEN 1 AND 12),
  ADD CONSTRAINT "Makerspace_positive_limits" CHECK ("managerLimit" IS NULL OR "managerLimit" > 0),
  ADD CONSTRAINT "Makerspace_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$');

-- The applicant is always told why: a refusal or a change request carries a note.
ALTER TABLE "MakerspaceReview"
  ADD CONSTRAINT "MakerspaceReview_reason_required" CHECK (
    "action" NOT IN ('REJECTED', 'CHANGES_REQUESTED') OR length(btrim(coalesce("reason", ''))) > 0
  );

ALTER TABLE "MakerspaceTaxSettings"
  ADD CONSTRAINT "MakerspaceTaxSettings_rate_range" CHECK ("rateBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "MakerspaceTaxSettings_prefix_format" CHECK ("receiptPrefix" ~ '^[A-Z0-9]{0,4}$'),
  ADD CONSTRAINT "MakerspaceTaxSettings_sac_format" CHECK ("sacCode" ~ '^[0-9]{4,8}$'),
  ADD CONSTRAINT "MakerspaceTaxSettings_gst_ready" CHECK ("mode" <> 'GST' OR ("gstin" IS NOT NULL AND "legalName" IS NOT NULL AND "stateCode" IS NOT NULL));

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_nonnegative" CHECK ("amountMinor" >= 0 AND ("capturedMinor" IS NULL OR "capturedMinor" >= 0)),
  ADD CONSTRAINT "Payment_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Payment_paid_has_date" CHECK ("status" NOT IN ('PAID', 'WAIVED') OR "paidAt" IS NOT NULL),
  ADD CONSTRAINT "Payment_offline_has_no_gateway" CHECK ("provider" <> 'OFFLINE' OR "gatewayOrderId" IS NULL),
  ADD CONSTRAINT "Payment_customer_email_lowercase" CHECK ("customerEmail" = lower("customerEmail")),
  ADD CONSTRAINT "Payment_customer_present" CHECK (char_length("customerName") BETWEEN 1 AND 200 AND char_length("customerEmail") BETWEEN 3 AND 320);

-- A UPI or bank reference is recorded once per makerspace, but a rejected one can be entered again.
CREATE UNIQUE INDEX "Payment_offline_utr_once" ON "Payment" ("makerspaceId", "utr")
  WHERE "provider" = 'OFFLINE' AND "utr" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'FAILED');

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

ALTER TABLE "MakerspaceEmailSettings"
  ADD CONSTRAINT "MakerspaceEmailSettings_port" CHECK ("smtpPort" IN (25, 465, 587, 2525)),
  ADD CONSTRAINT "MakerspaceEmailSettings_enabled_complete" CHECK (NOT "enabled" OR ("fromAddress" IS NOT NULL AND "smtpHost" IS NOT NULL)),
  ADD CONSTRAINT "MakerspaceEmailSettings_from_name_length" CHECK (char_length("fromName") <= 120);

-- The events list matches lib/chat/events.ts CHAT_EVENTS.
ALTER TABLE "ChatChannel"
  ADD CONSTRAINT "ChatChannel_name_length" CHECK (char_length("name") BETWEEN 1 AND 80),
  ADD CONSTRAINT "ChatChannel_events_known" CHECK ("events" <@ ARRAY['payment', 'payment-to-confirm']::text[]);

-- ── Money immutability (column allowlists, not whole-row freezes) ──────────

CREATE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER "Payment_guard" BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION payment_guard();

CREATE FUNCTION payment_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lines of a payment that never settled may go with it (an unpaid makerspace being deleted).
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
    OR NEW."makerspaceId" IS DISTINCT FROM OLD."makerspaceId"
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
    OR NEW."makerspaceId" IS DISTINCT FROM OLD."makerspaceId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
  THEN
    RAISE EXCEPTION 'A refund can only move on from pending' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Refund_guard" BEFORE UPDATE OR DELETE ON "Refund" FOR EACH ROW EXECUTE FUNCTION refund_guard();
