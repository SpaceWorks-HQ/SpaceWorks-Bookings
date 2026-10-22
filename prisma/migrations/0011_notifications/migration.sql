-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('SLACK', 'DISCORD', 'MATTERMOST', 'TELEGRAM', 'WHATSAPP');

-- AlterTable
ALTER TABLE "Makerspace" ADD COLUMN     "memberPortal" BOOLEAN NOT NULL DEFAULT true;

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
CREATE INDEX "ChatChannel_makerspaceId_idx" ON "ChatChannel"("makerspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_makerspaceId_id_key" ON "ChatChannel"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_tokenHash_key" ON "KnownDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "KnownDevice_userId_lastSeenAt_idx" ON "KnownDevice"("userId", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "MakerspaceEmailSettings" ADD CONSTRAINT "MakerspaceEmailSettings_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written rules (not expressible in the Prisma schema).
ALTER TABLE "MakerspaceEmailSettings"
  ADD CONSTRAINT "MakerspaceEmailSettings_port" CHECK ("smtpPort" IN (25, 465, 587, 2525)),
  ADD CONSTRAINT "MakerspaceEmailSettings_enabled_complete" CHECK (NOT "enabled" OR ("fromAddress" IS NOT NULL AND "smtpHost" IS NOT NULL)),
  ADD CONSTRAINT "MakerspaceEmailSettings_from_name_length" CHECK (char_length("fromName") <= 120);

ALTER TABLE "ChatChannel"
  ADD CONSTRAINT "ChatChannel_name_length" CHECK (char_length("name") BETWEEN 1 AND 80),
  ADD CONSTRAINT "ChatChannel_events_known" CHECK ("events" <@ ARRAY['application', 'payment', 'payment-to-confirm', 'refund-requested', 'erasure-requested', 'member-left', 'monthly-summary']::text[]);
