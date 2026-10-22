-- CreateEnum
CREATE TYPE "OrganisationVisibility" AS ENUM ('UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PlanDurationType" AS ENUM ('ROLLING', 'ORG_YEAR', 'FIXED_END', 'LIFETIME');

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
ALTER TABLE "Organisation" ADD COLUMN     "locale" TEXT,
ADD COLUMN     "unitLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visibility" "OrganisationVisibility" NOT NULL DEFAULT 'UNLISTED';

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberRole" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
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
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "durationType" "PlanDurationType" NOT NULL DEFAULT 'ORG_YEAR',
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
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "PlanUnit_pkey" PRIMARY KEY ("planId","unitId")
);

-- CreateTable
CREATE TABLE "PlanField" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
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
    "organisationId" TEXT NOT NULL,
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
    "organisationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberRoleAssignment_pkey" PRIMARY KEY ("memberId","roleId")
);

-- CreateTable
CREATE TABLE "MembershipTerm" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
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
    "organisationId" TEXT NOT NULL,
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
    "organisationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "noticeVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "byGuardian" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgCounter" (
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "OrgCounter_pkey" PRIMARY KEY ("organisationId","name")
);

-- CreateTable
CREATE TABLE "MemberInvite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
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
CREATE INDEX "OrgUnit_organisationId_path_idx" ON "OrgUnit"("organisationId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_organisationId_id_key" ON "OrgUnit"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_organisationId_slug_key" ON "OrgUnit"("organisationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "MemberRole_organisationId_id_key" ON "MemberRole"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MemberRole_organisationId_name_key" ON "MemberRole"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_organisationId_id_key" ON "MembershipPlan"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_organisationId_slug_key" ON "MembershipPlan"("organisationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PlanField_planId_key_key" ON "PlanField"("planId", "key");

-- CreateIndex
CREATE INDEX "Member_userId_idx" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_organisationId_unitId_idx" ON "Member"("organisationId", "unitId");

-- CreateIndex
CREATE INDEX "Member_organisationId_createdAt_idx" ON "Member"("organisationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Member_organisationId_id_key" ON "Member"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Member_organisationId_email_key" ON "Member"("organisationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Member_organisationId_memberNumber_key" ON "Member"("organisationId", "memberNumber");

-- CreateIndex
CREATE INDEX "MemberRoleAssignment_organisationId_roleId_idx" ON "MemberRoleAssignment"("organisationId", "roleId");

-- CreateIndex
CREATE INDEX "MembershipTerm_organisationId_status_endsAt_idx" ON "MembershipTerm"("organisationId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "MembershipTerm_memberId_planId_idx" ON "MembershipTerm"("memberId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipTerm_organisationId_id_key" ON "MembershipTerm"("organisationId", "id");

-- CreateIndex
CREATE INDEX "TermStatusEvent_termId_recordedAt_idx" ON "TermStatusEvent"("termId", "recordedAt");

-- CreateIndex
CREATE INDEX "TermStatusEvent_organisationId_effectiveAt_idx" ON "TermStatusEvent"("organisationId", "effectiveAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_memberId_idx" ON "ConsentRecord"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberInvite_token_key" ON "MemberInvite"("token");

-- CreateIndex
CREATE INDEX "MemberInvite_organisationId_planId_idx" ON "MemberInvite"("organisationId", "planId");

-- CreateIndex
CREATE INDEX "Organisation_visibility_status_idx" ON "Organisation"("visibility", "status");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_organisationId_unitId_fkey" FOREIGN KEY ("organisationId", "unitId") REFERENCES "OrgUnit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_organisationId_parentId_fkey" FOREIGN KEY ("organisationId", "parentId") REFERENCES "OrgUnit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRole" ADD CONSTRAINT "MemberRole_organisationId_unitId_fkey" FOREIGN KEY ("organisationId", "unitId") REFERENCES "OrgUnit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanUnit" ADD CONSTRAINT "PlanUnit_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanUnit" ADD CONSTRAINT "PlanUnit_organisationId_unitId_fkey" FOREIGN KEY ("organisationId", "unitId") REFERENCES "OrgUnit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlanField" ADD CONSTRAINT "PlanField_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_organisationId_unitId_fkey" FOREIGN KEY ("organisationId", "unitId") REFERENCES "OrgUnit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MemberRoleAssignment" ADD CONSTRAINT "MemberRoleAssignment_organisationId_memberId_fkey" FOREIGN KEY ("organisationId", "memberId") REFERENCES "Member"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberRoleAssignment" ADD CONSTRAINT "MemberRoleAssignment_organisationId_roleId_fkey" FOREIGN KEY ("organisationId", "roleId") REFERENCES "MemberRole"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_organisationId_memberId_fkey" FOREIGN KEY ("organisationId", "memberId") REFERENCES "Member"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTerm" ADD CONSTRAINT "MembershipTerm_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "MembershipTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermStatusEvent" ADD CONSTRAINT "TermStatusEvent_termId_fkey" FOREIGN KEY ("termId") REFERENCES "MembershipTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_termId_fkey" FOREIGN KEY ("termId") REFERENCES "MembershipTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_organisationId_memberId_fkey" FOREIGN KEY ("organisationId", "memberId") REFERENCES "Member"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgCounter" ADD CONSTRAINT "OrgCounter_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


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
    OR ("durationType" IN ('ORG_YEAR', 'LIFETIME'))
  ),
  ADD CONSTRAINT "MembershipPlan_days_sane" CHECK ("graceDays" BETWEEN 0 AND 365 AND "renewalWindowDays" BETWEEN 0 AND 365),
  ADD CONSTRAINT "MembershipPlan_rejoin_days" CHECK ("rejoinFeeRule" <> 'AFTER_LAPSE' OR "rejoinAfterDays" IS NOT NULL);

ALTER TABLE "OrgUnit"
  ADD CONSTRAINT "OrgUnit_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "OrgUnit_level_range" CHECK ("level" BETWEEN 0 AND 3),
  ADD CONSTRAINT "OrgUnit_not_own_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "Member"
  ADD CONSTRAINT "Member_number_positive" CHECK ("memberNumber" > 0),
  ADD CONSTRAINT "Member_email_lowercase" CHECK ("email" = lower("email"));

-- One primary role per member.
CREATE UNIQUE INDEX "MemberRoleAssignment_one_primary" ON "MemberRoleAssignment" ("memberId") WHERE "isPrimary";

ALTER TABLE "OrgCounter" ADD CONSTRAINT "OrgCounter_next_positive" CHECK ("next" > 0);

ALTER TABLE "MemberInvite"
  ADD CONSTRAINT "MemberInvite_uses_bounded" CHECK ("maxUses" BETWEEN 1 AND 10000 AND "uses" BETWEEN 0 AND "maxUses");
