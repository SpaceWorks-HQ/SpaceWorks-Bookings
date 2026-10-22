-- CreateEnum
CREATE TYPE "MakerspaceVisibility" AS ENUM ('UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PlanDurationType" AS ENUM ('ROLLING', 'MAKERSPACE_YEAR', 'FIXED_END', 'LIFETIME');

-- CreateEnum
CREATE TYPE "RejoinFeeRule" AS ENUM ('NEVER', 'ONCE', 'EACH_JOIN', 'AFTER_LAPSE');

-- CreateEnum
CREATE TYPE "JoinMode" AS ENUM ('OPEN', 'APPROVAL', 'INVITE_ONLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentTiming" AS ENUM ('PAY_THEN_ACTIVATE', 'ACTIVATE_THEN_CHARGE');

-- CreateEnum
CREATE TYPE "PlanFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'SELECT', 'DATE', 'EMAIL', 'PHONE', 'NUMBER', 'CHECKBOX');

-- CreateEnum
CREATE TYPE "MemberSource" AS ENUM ('JOIN_FORM', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING_PAYMENT', 'UPCOMING', 'ACTIVE', 'GRACE', 'ENDED', 'LAPSED', 'EXPIRED', 'CANCELLED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TermKind" AS ENUM ('NEW', 'RENEWAL', 'REINSTATEMENT');

-- AlterTable
ALTER TABLE "Makerspace" ADD COLUMN     "locale" TEXT,
ADD COLUMN     "unitLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibility" "MakerspaceVisibility" NOT NULL DEFAULT 'UNLISTED';

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "MakerspaceUnit" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MakerspaceUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberRole" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'teal',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "unitId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "durationType" "PlanDurationType" NOT NULL DEFAULT 'MAKERSPACE_YEAR',
    "durationMonths" INTEGER,
    "fixedEndDate" TIMESTAMP(3),
    "priceNewMinor" INTEGER NOT NULL DEFAULT 0,
    "priceRenewalMinor" INTEGER NOT NULL DEFAULT 0,
    "joiningFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "rejoinFeeRule" "RejoinFeeRule" NOT NULL DEFAULT 'NEVER',
    "rejoinAfterDays" INTEGER,
    "graceDays" INTEGER NOT NULL DEFAULT 15,
    "renewalWindowDays" INTEGER NOT NULL DEFAULT 30,
    "reminderDaysBefore" INTEGER[] DEFAULT ARRAY[30, 7, 0]::INTEGER[],
    "reminderDaysAfter" INTEGER[] DEFAULT ARRAY[7]::INTEGER[],
    "lateRenewalBackdate" BOOLEAN NOT NULL DEFAULT true,
    "joinMode" "JoinMode" NOT NULL DEFAULT 'APPROVAL',
    "paymentTiming" "PaymentTiming" NOT NULL DEFAULT 'PAY_THEN_ACTIVATE',
    "allUnits" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanUnit" (
    "makerspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "PlanUnit_pkey" PRIMARY KEY ("planId","unitId")
);

-- CreateTable
CREATE TABLE "PlanField" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT NOT NULL DEFAULT '',
    "type" "PlanFieldType" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlanField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "photoUrl" TEXT,
    "stateCode" TEXT,
    "gstin" TEXT,
    "unitId" TEXT,
    "memberNumber" INTEGER NOT NULL,
    "fieldValues" JSONB NOT NULL DEFAULT '{}',
    "source" "MemberSource" NOT NULL DEFAULT 'JOIN_FORM',
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "guardianName" TEXT,
    "guardianEmail" TEXT,
    "guardianPhone" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "anonymisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberRoleAssignment" (
    "makerspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberRoleAssignment_pkey" PRIMARY KEY ("memberId","roleId")
);

-- CreateTable
CREATE TABLE "MembershipTerm" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "TermStatus" NOT NULL,
    "kind" "TermKind" NOT NULL DEFAULT 'NEW',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "paymentDueBy" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "joiningFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "renewedFromId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermStatusEvent" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "from" "TermStatus",
    "to" "TermStatus" NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "cause" TEXT NOT NULL,

    CONSTRAINT "TermStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "termId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("termId","key")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "byGuardian" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MakerspaceCounter" (
    "makerspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MakerspaceCounter_pkey" PRIMARY KEY ("makerspaceId","name")
);

-- CreateTable
CREATE TABLE "MemberInvite" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "unitId" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MakerspaceUnit_makerspaceId_path_idx" ON "MakerspaceUnit"("makerspaceId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "MakerspaceUnit_makerspaceId_id_key" ON "MakerspaceUnit"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MakerspaceUnit_makerspaceId_slug_key" ON "MakerspaceUnit"("makerspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "MemberRole_makerspaceId_id_key" ON "MemberRole"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MemberRole_makerspaceId_name_key" ON "MemberRole"("makerspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_makerspaceId_id_key" ON "MembershipPlan"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_makerspaceId_slug_key" ON "MembershipPlan"("makerspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PlanField_planId_key_key" ON "PlanField"("planId", "key");

-- CreateIndex
CREATE INDEX "Member_userId_idx" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_makerspaceId_unitId_idx" ON "Member"("makerspaceId", "unitId");

-- CreateIndex
CREATE INDEX "Member_makerspaceId_createdAt_idx" ON "Member"("makerspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Member_makerspaceId_id_key" ON "Member"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Member_makerspaceId_email_key" ON "Member"("makerspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Member_makerspaceId_memberNumber_key" ON "Member"("makerspaceId", "memberNumber");

-- CreateIndex
CREATE INDEX "MemberRoleAssignment_makerspaceId_roleId_idx" ON "MemberRoleAssignment"("makerspaceId", "roleId");

-- CreateIndex
CREATE INDEX "MembershipTerm_makerspaceId_status_endsAt_idx" ON "MembershipTerm"("makerspaceId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "MembershipTerm_memberId_planId_idx" ON "MembershipTerm"("memberId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipTerm_makerspaceId_id_key" ON "MembershipTerm"("makerspaceId", "id");

-- CreateIndex
CREATE INDEX "TermStatusEvent_termId_recordedAt_idx" ON "TermStatusEvent"("termId", "recordedAt");

-- CreateIndex
CREATE INDEX "TermStatusEvent_makerspaceId_effectiveAt_idx" ON "TermStatusEvent"("makerspaceId", "effectiveAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_memberId_idx" ON "ConsentRecord"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberInvite_token_key" ON "MemberInvite"("token");

-- CreateIndex
CREATE INDEX "MemberInvite_makerspaceId_planId_idx" ON "MemberInvite"("makerspaceId", "planId");

-- CreateIndex
CREATE INDEX "Makerspace_visibility_status_idx" ON "Makerspace"("visibility", "status");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_makerspaceId_unitId_fkey" FOREIGN KEY ("makerspaceId", "unitId") REFERENCES "MakerspaceUnit"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MakerspaceUnit" ADD CONSTRAINT "MakerspaceUnit_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceUnit" ADD CONSTRAINT "MakerspaceUnit_makerspaceId_parentId_fkey" FOREIGN KEY ("makerspaceId", "parentId") REFERENCES "MakerspaceUnit"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_makerspaceId_unitId_fkey" FOREIGN KEY ("makerspaceId", "unitId") REFERENCES "MakerspaceUnit"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanUnit" ADD CONSTRAINT "PlanUnit_makerspaceId_planId_fkey" FOREIGN KEY ("makerspaceId", "planId") REFERENCES "MembershipPlan"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanUnit" ADD CONSTRAINT "PlanUnit_makerspaceId_unitId_fkey" FOREIGN KEY ("makerspaceId", "unitId") REFERENCES "MakerspaceUnit"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlanField" ADD CONSTRAINT "PlanField_makerspaceId_planId_fkey" FOREIGN KEY ("makerspaceId", "planId") REFERENCES "MembershipPlan"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_makerspaceId_unitId_fkey" FOREIGN KEY ("makerspaceId", "unitId") REFERENCES "MakerspaceUnit"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberRoleAssignment" ADD CONSTRAINT "MemberRoleAssignment_makerspaceId_memberId_fkey" FOREIGN KEY ("makerspaceId", "memberId") REFERENCES "Member"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRoleAssignment" ADD CONSTRAINT "MemberRoleAssignment_makerspaceId_roleId_fkey" FOREIGN KEY ("makerspaceId", "roleId") REFERENCES "MemberRole"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_makerspaceId_memberId_fkey" FOREIGN KEY ("makerspaceId", "memberId") REFERENCES "Member"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_makerspaceId_planId_fkey" FOREIGN KEY ("makerspaceId", "planId") REFERENCES "MembershipPlan"("makerspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "MembershipTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermStatusEvent" ADD CONSTRAINT "TermStatusEvent_termId_fkey" FOREIGN KEY ("termId") REFERENCES "MembershipTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_termId_fkey" FOREIGN KEY ("termId") REFERENCES "MembershipTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_makerspaceId_memberId_fkey" FOREIGN KEY ("makerspaceId", "memberId") REFERENCES "Member"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceCounter" ADD CONSTRAINT "MakerspaceCounter_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_makerspaceId_planId_fkey" FOREIGN KEY ("makerspaceId", "planId") REFERENCES "MembershipPlan"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------
-- Integrity rules Prisma cannot express.
-- ---------------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No two live terms of one member on one plan may overlap in time.
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_no_overlap"
  EXCLUDE USING gist ("memberId" WITH =, "planId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("status" IN ('UPCOMING', 'ACTIVE', 'GRACE') AND "startsAt" IS NOT NULL);

-- At most one open application or unpaid term per member and plan.
CREATE UNIQUE INDEX "MembershipTerm_one_pending" ON "MembershipTerm" ("memberId", "planId")
  WHERE "status" IN ('PENDING_APPROVAL', 'PENDING_PAYMENT');

-- A term is renewed at most once by a live successor.
CREATE UNIQUE INDEX "MembershipTerm_one_successor" ON "MembershipTerm" ("renewedFromId")
  WHERE "renewedFromId" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'EXPIRED', 'REJECTED');

ALTER TABLE "MembershipTerm"
  ADD CONSTRAINT "MembershipTerm_money_nonnegative" CHECK ("priceMinor" >= 0 AND "joiningFeeMinor" >= 0),
  ADD CONSTRAINT "MembershipTerm_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MembershipTerm_dates_ordered" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "MembershipTerm_grace_after_end" CHECK ("graceUntil" IS NULL OR ("endsAt" IS NOT NULL AND "graceUntil" >= "endsAt")),
  -- Live terms always have a start; only lifetime plans have no end.
  ADD CONSTRAINT "MembershipTerm_live_has_start" CHECK ("status" NOT IN ('UPCOMING', 'ACTIVE', 'GRACE', 'ENDED', 'LAPSED') OR "startsAt" IS NOT NULL);

ALTER TABLE "MembershipPlan"
  ADD CONSTRAINT "MembershipPlan_money_nonnegative" CHECK ("priceNewMinor" >= 0 AND "priceRenewalMinor" >= 0 AND "joiningFeeMinor" >= 0),
  ADD CONSTRAINT "MembershipPlan_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MembershipPlan_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "MembershipPlan_duration_shape" CHECK (
    ("durationType" = 'ROLLING' AND "durationMonths" BETWEEN 1 AND 120)
    OR ("durationType" = 'FIXED_END' AND "fixedEndDate" IS NOT NULL)
    OR ("durationType" IN ('MAKERSPACE_YEAR', 'LIFETIME'))
  ),
  ADD CONSTRAINT "MembershipPlan_days_sane" CHECK ("graceDays" BETWEEN 0 AND 365 AND "renewalWindowDays" BETWEEN 0 AND 365),
  ADD CONSTRAINT "MembershipPlan_rejoin_days" CHECK ("rejoinFeeRule" <> 'AFTER_LAPSE' OR "rejoinAfterDays" IS NOT NULL);

ALTER TABLE "MakerspaceUnit"
  ADD CONSTRAINT "MakerspaceUnit_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "MakerspaceUnit_level_range" CHECK ("level" BETWEEN 0 AND 3),
  ADD CONSTRAINT "MakerspaceUnit_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "Member"
  ADD CONSTRAINT "Member_number_positive" CHECK ("memberNumber" > 0),
  ADD CONSTRAINT "Member_email_lowercase" CHECK ("email" = lower("email"));

-- One primary role per member.
CREATE UNIQUE INDEX "MemberRoleAssignment_one_primary" ON "MemberRoleAssignment" ("memberId") WHERE "isPrimary";

ALTER TABLE "MakerspaceCounter" ADD CONSTRAINT "MakerspaceCounter_next_positive" CHECK ("next" > 0);

ALTER TABLE "MemberInvite"
  ADD CONSTRAINT "MemberInvite_uses_bounded" CHECK ("maxUses" BETWEEN 1 AND 10000 AND "uses" BETWEEN 0 AND "maxUses");
