-- CreateEnum
CREATE TYPE "CardExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "CardDesign" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT,
    "design" JSONB NOT NULL,
    "numberPrefix" TEXT NOT NULL,
    "watermarkUrl" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberCard" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedReason" TEXT,
    "lastEmailedAt" TIMESTAMP(3),

    CONSTRAINT "MemberCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardExportJob" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "format" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "status" "CardExportStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cardCount" INTEGER,
    "storageKey" TEXT,
    "byteSize" INTEGER,
    "error" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CardExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardDesign_organisationId_id_key" ON "CardDesign"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CardDesign_organisationId_planId_key" ON "CardDesign"("organisationId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCard_verifyToken_key" ON "MemberCard"("verifyToken");

-- CreateIndex
CREATE INDEX "MemberCard_memberId_planId_idx" ON "MemberCard"("memberId", "planId");

-- CreateIndex
CREATE INDEX "MemberCard_organisationId_issuedAt_idx" ON "MemberCard"("organisationId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemberCard_organisationId_id_key" ON "MemberCard"("organisationId", "id");

-- CreateIndex
CREATE INDEX "CardExportJob_status_createdAt_idx" ON "CardExportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CardExportJob_organisationId_createdAt_idx" ON "CardExportJob"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CardDesign" ADD CONSTRAINT "CardDesign_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardDesign" ADD CONSTRAINT "CardDesign_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCard" ADD CONSTRAINT "MemberCard_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCard" ADD CONSTRAINT "MemberCard_organisationId_memberId_fkey" FOREIGN KEY ("organisationId", "memberId") REFERENCES "Member"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberCard" ADD CONSTRAINT "MemberCard_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardExportJob" ADD CONSTRAINT "CardExportJob_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written constraints -------------------------------------------------------------------------

-- One organisation-wide default design; plan designs are unique through (organisationId, planId).
CREATE UNIQUE INDEX "CardDesign_org_default_key" ON "CardDesign"("organisationId") WHERE "planId" IS NULL;

ALTER TABLE "CardDesign"
  ADD CONSTRAINT "CardDesign_number_prefix_format" CHECK ("numberPrefix" ~ '^[A-Z0-9]{1,6}$');

-- At most one live card per member and plan; revoked and replaced cards stay as history.
CREATE UNIQUE INDEX "MemberCard_live_key" ON "MemberCard"("memberId", "planId") WHERE "revokedAt" IS NULL;

ALTER TABLE "MemberCard"
  ADD CONSTRAINT "MemberCard_token_format" CHECK ("verifyToken" ~ '^[A-Za-z0-9_-]{43}$'),
  ADD CONSTRAINT "MemberCard_revoked_with_reason" CHECK (("revokedAt" IS NULL) = ("revokedReason" IS NULL)),
  ADD CONSTRAINT "MemberCard_revoked_reason" CHECK ("revokedReason" IS NULL OR "revokedReason" IN ('REISSUED', 'REVOKED', 'MEMBERSHIP_ENDED'));

ALTER TABLE "CardExportJob"
  ADD CONSTRAINT "CardExportJob_format" CHECK ("format" IN ('sheet', 'cards', 'zip'));
