-- CreateEnum
CREATE TYPE "ErasureStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "MakerspacePage" (
    "makerspaceId" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "coverAssetKey" TEXT,
    "accentColor" TEXT,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "publishedAt" TIMESTAMP(3),
    "draft" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerspacePage_pkey" PRIMARY KEY ("makerspaceId")
);

-- CreateTable
CREATE TABLE "ErasureRequest" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "status" "ErasureStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureRequest_makerspaceId_status_createdAt_idx" ON "ErasureRequest"("makerspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ErasureRequest_memberId_idx" ON "ErasureRequest"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ErasureRequest_makerspaceId_id_key" ON "ErasureRequest"("makerspaceId", "id");

-- AddForeignKey
ALTER TABLE "MakerspacePage" ADD CONSTRAINT "MakerspacePage_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErasureRequest" ADD CONSTRAINT "ErasureRequest_makerspaceId_memberId_fkey" FOREIGN KEY ("makerspaceId", "memberId") REFERENCES "Member"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written constraints (not expressible in the Prisma schema).

-- At most one open erasure request per member.
CREATE UNIQUE INDEX "ErasureRequest_one_pending" ON "ErasureRequest" ("memberId") WHERE "status" = 'PENDING';

ALTER TABLE "ErasureRequest"
  ADD CONSTRAINT "ErasureRequest_decided_shape" CHECK (("status" NOT IN ('APPROVED', 'REJECTED') OR "decidedAt" IS NOT NULL) AND ("status" <> 'PENDING' OR "decidedAt" IS NULL)),
  ADD CONSTRAINT "ErasureRequest_reason_length" CHECK (char_length("reason") <= 1000 AND ("decisionNote" IS NULL OR char_length("decisionNote") <= 1000));

ALTER TABLE "MakerspacePage"
  ADD CONSTRAINT "MakerspacePage_accent_hex" CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-F]{6}$'),
  ADD CONSTRAINT "MakerspacePage_tagline_length" CHECK (char_length("tagline") <= 160),
  ADD CONSTRAINT "MakerspacePage_sections_array" CHECK (jsonb_typeof("sections") = 'array');
