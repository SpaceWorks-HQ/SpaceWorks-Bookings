-- Phase 1 bookings: settings, spaces, availability, pricing inputs, bookings and occurrences.
-- The raw section at the end holds what Prisma cannot express (docs/BOOKINGS.md).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "SpaceKind" AS ENUM ('ROOM', 'STUDIO', 'DESK', 'HALL', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('INSTANT', 'APPROVAL');

-- CreateEnum
CREATE TYPE "ChargeMode" AS ENUM ('FREE', 'PAY_NOW', 'DEPOSIT', 'PAY_LATER');

-- CreateEnum
CREATE TYPE "DepositKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PayLaterDueRule" AS ENUM ('BEFORE_START', 'AFTER_BOOKING');

-- CreateEnum
CREATE TYPE "OverdueAction" AS ENUM ('AUTO_CANCEL', 'NOTIFY_STAFF');

-- CreateEnum
CREATE TYPE "NoShowCharge" AS ENUM ('FULL', 'NONE');

-- CreateEnum
CREATE TYPE "AddOnUnit" AS ENUM ('PER_BOOKING', 'PER_HOUR', 'PER_PERSON');

-- CreateEnum
CREATE TYPE "RateKind" AS ENUM ('PUBLIC', 'MEMBER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'REQUESTED', 'CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('PUBLIC', 'GUEST', 'STAFF', 'API');

-- CreateEnum
CREATE TYPE "CancelKind" AS ENUM ('CUSTOMER', 'STAFF', 'VENUE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CalendarFeedKind" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateTable
CREATE TABLE "MakerspaceBookingSettings" (
    "makerspaceId" TEXT NOT NULL,
    "approvalMode" "ApprovalMode" NOT NULL DEFAULT 'INSTANT',
    "requestsBlockSlot" BOOLEAN NOT NULL DEFAULT true,
    "requestExpiryHours" INTEGER NOT NULL DEFAULT 48,
    "approvalPayWithinHours" INTEGER NOT NULL DEFAULT 24,
    "minDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxDurationMinutes" INTEGER NOT NULL DEFAULT 480,
    "slotStepMinutes" INTEGER NOT NULL DEFAULT 30,
    "leadTimeMinutes" INTEGER NOT NULL DEFAULT 60,
    "advanceWindowDays" INTEGER NOT NULL DEFAULT 90,
    "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "holdMinutes" INTEGER NOT NULL DEFAULT 15,
    "recurrenceMaxOccurrences" INTEGER NOT NULL DEFAULT 52,
    "guestBookingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "customerCancelCutoffHours" INTEGER NOT NULL DEFAULT 0,
    "customerRescheduleAllowed" BOOLEAN NOT NULL DEFAULT true,
    "customerRescheduleCutoffHours" INTEGER NOT NULL DEFAULT 24,
    "selfCheckInEnabled" BOOLEAN NOT NULL DEFAULT false,
    "selfCheckInOpensMinutesBefore" INTEGER NOT NULL DEFAULT 15,
    "selfCheckInClosesMinutesAfter" INTEGER NOT NULL DEFAULT 30,
    "autoNoShow" BOOLEAN NOT NULL DEFAULT false,
    "noShowGraceMinutes" INTEGER NOT NULL DEFAULT 30,
    "noShowReleasesSlot" BOOLEAN NOT NULL DEFAULT true,
    "noShowCharge" "NoShowCharge" NOT NULL DEFAULT 'FULL',
    "reminderHoursBefore" INTEGER[] DEFAULT ARRAY[24]::INTEGER[],
    "chargeMode" "ChargeMode" NOT NULL DEFAULT 'FREE',
    "allowPayLater" BOOLEAN NOT NULL DEFAULT false,
    "depositKind" "DepositKind" NOT NULL DEFAULT 'PERCENT',
    "depositPercentBps" INTEGER NOT NULL DEFAULT 5000,
    "depositFixedMinor" INTEGER NOT NULL DEFAULT 0,
    "depositRefundable" BOOLEAN NOT NULL DEFAULT true,
    "payLaterDueRule" "PayLaterDueRule" NOT NULL DEFAULT 'BEFORE_START',
    "payLaterDueHoursBeforeStart" INTEGER NOT NULL DEFAULT 24,
    "payLaterDueDaysAfterBooking" INTEGER NOT NULL DEFAULT 7,
    "payLaterMinWindowHours" INTEGER NOT NULL DEFAULT 2,
    "payLaterMinLeadHours" INTEGER NOT NULL DEFAULT 2,
    "overdueAction" "OverdueAction" NOT NULL DEFAULT 'NOTIFY_STAFF',
    "paymentReminderHoursBeforeDue" INTEGER[] DEFAULT ARRAY[24]::INTEGER[],
    "overdueReminderHoursAfterDue" INTEGER[] DEFAULT ARRAY[24]::INTEGER[],
    "chargeLateCancelWhenUnpaid" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerspaceBookingSettings_pkey" PRIMARY KEY ("makerspaceId")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SpaceKind" NOT NULL DEFAULT 'ROOM',
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "units" INTEGER NOT NULL DEFAULT 1,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "colour" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ruleOverrides" JSONB NOT NULL DEFAULT '{}',
    "publicHourlyMinor" INTEGER,
    "publicHalfDayMinor" INTEGER,
    "publicDayMinor" INTEGER,
    "memberHourlyMinor" INTEGER,
    "memberHalfDayMinor" INTEGER,
    "memberDayMinor" INTEGER,
    "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,
    "dayMinutes" INTEGER NOT NULL DEFAULT 480,
    "taxRateBps" INTEGER,
    "sacCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpacePhoto" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "alt" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpacePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningHours" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "weekday" INTEGER NOT NULL,
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,

    CONSTRAINT "OpeningHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoursException" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT true,
    "intervals" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "HoursException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blackout" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeakRule" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "surchargeBps" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PeakRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOn" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "unit" "AddOnUnit" NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "memberPriceMinor" INTEGER,
    "sacCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundTier" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "minHoursBefore" INTEGER NOT NULL,
    "refundBps" INTEGER NOT NULL,

    CONSTRAINT "RefundTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MakerspaceMember" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "validUntil" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "source" "BookingSource" NOT NULL,
    "customerUserId" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "attendees" INTEGER NOT NULL DEFAULT 1,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT NOT NULL DEFAULT '',
    "internalNotes" TEXT NOT NULL DEFAULT '',
    "rateKind" "RateKind" NOT NULL DEFAULT 'PUBLIC',
    "chargeMode" "ChargeMode" NOT NULL DEFAULT 'FREE',
    "allowPayLater" BOOLEAN NOT NULL DEFAULT false,
    "payLater" BOOLEAN NOT NULL DEFAULT false,
    "awaitingPayment" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "depositMinor" INTEGER NOT NULL DEFAULT 0,
    "chargeMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "paymentDueAt" TIMESTAMP(3),
    "overdueAction" "OverdueAction",
    "priceSnapshot" JSONB NOT NULL DEFAULT '{}',
    "policySnapshot" JSONB NOT NULL DEFAULT '{}',
    "holdExpiresAt" TIMESTAMP(3),
    "requestExpiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "manageTokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "overrideReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declinedById" TEXT,
    "declineReason" TEXT,
    "expiredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelKind" "CancelKind",
    "cancelReason" TEXT,
    "writtenOffAt" TIMESTAMP(3),
    "writtenOffById" TEXT,
    "writtenOffReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingOccurrence" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "unit" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "blockStart" TIMESTAMPTZ(3) NOT NULL,
    "blockEnd" TIMESTAMPTZ(3) NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "rateKind" "RateKind" NOT NULL DEFAULT 'PUBLIC',
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "keptFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "policyAnchorAt" TIMESTAMP(3) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "cancelKind" "CancelKind",
    "checkedInAt" TIMESTAMP(3),
    "checkedInById" TEXT,
    "noShowAt" TIMESTAMP(3),
    "noShowById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "occurrenceId" TEXT,
    "kind" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarFeed" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
    "kind" "CalendarFeedKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Space_makerspaceId_archivedAt_sortOrder_idx" ON "Space"("makerspaceId", "archivedAt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Space_makerspaceId_slug_key" ON "Space"("makerspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Space_makerspaceId_id_key" ON "Space"("makerspaceId", "id");

-- CreateIndex
CREATE INDEX "SpacePhoto_spaceId_sortOrder_idx" ON "SpacePhoto"("spaceId", "sortOrder");

-- CreateIndex
CREATE INDEX "OpeningHours_makerspaceId_spaceId_weekday_idx" ON "OpeningHours"("makerspaceId", "spaceId", "weekday");

-- CreateIndex
CREATE INDEX "HoursException_makerspaceId_spaceId_date_idx" ON "HoursException"("makerspaceId", "spaceId", "date");

-- CreateIndex
CREATE INDEX "Blackout_makerspaceId_spaceId_idx" ON "Blackout"("makerspaceId", "spaceId");

-- CreateIndex
CREATE INDEX "PeakRule_makerspaceId_spaceId_idx" ON "PeakRule"("makerspaceId", "spaceId");

-- CreateIndex
CREATE INDEX "AddOn_makerspaceId_spaceId_active_idx" ON "AddOn"("makerspaceId", "spaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_makerspaceId_id_key" ON "AddOn"("makerspaceId", "id");

-- CreateIndex
CREATE INDEX "RefundTier_makerspaceId_spaceId_idx" ON "RefundTier"("makerspaceId", "spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MakerspaceMember_makerspaceId_email_key" ON "MakerspaceMember"("makerspaceId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_manageTokenHash_key" ON "Booking"("manageTokenHash");

-- CreateIndex
CREATE INDEX "Booking_makerspaceId_status_createdAt_idx" ON "Booking"("makerspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_status_requestExpiresAt_idx" ON "Booking"("status", "requestExpiresAt");

-- CreateIndex
CREATE INDEX "Booking_customerUserId_idx" ON "Booking"("customerUserId");

-- CreateIndex
CREATE INDEX "Booking_makerspaceId_contactEmail_idx" ON "Booking"("makerspaceId", "contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_makerspaceId_reference_key" ON "Booking"("makerspaceId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_makerspaceId_id_key" ON "Booking"("makerspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_id_spaceId_key" ON "Booking"("id", "spaceId");

-- CreateIndex
CREATE INDEX "BookingOccurrence_bookingId_slotIndex_idx" ON "BookingOccurrence"("bookingId", "slotIndex");

-- CreateIndex
CREATE INDEX "BookingOccurrence_spaceId_unit_blockStart_idx" ON "BookingOccurrence"("spaceId", "unit", "blockStart");

-- CreateIndex
CREATE INDEX "BookingOccurrence_makerspaceId_startsAt_idx" ON "BookingOccurrence"("makerspaceId", "startsAt");

-- CreateIndex
CREATE INDEX "BookingOccurrence_status_blockEnd_idx" ON "BookingOccurrence"("status", "blockEnd");

-- CreateIndex
CREATE INDEX "BookingOccurrence_status_startsAt_idx" ON "BookingOccurrence"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingOccurrence_makerspaceId_id_key" ON "BookingOccurrence"("makerspaceId", "id");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingEvent_makerspaceId_createdAt_idx" ON "BookingEvent"("makerspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_occurrenceId_kind_startsAt_key" ON "ReminderLog"("occurrenceId", "kind", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_tokenHash_key" ON "CalendarFeed"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_makerspaceId_userId_kind_key" ON "CalendarFeed"("makerspaceId", "userId", "kind");

-- AddForeignKey
ALTER TABLE "MakerspaceBookingSettings" ADD CONSTRAINT "MakerspaceBookingSettings_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpacePhoto" ADD CONSTRAINT "SpacePhoto_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpacePhoto" ADD CONSTRAINT "SpacePhoto_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningHours" ADD CONSTRAINT "OpeningHours_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningHours" ADD CONSTRAINT "OpeningHours_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursException" ADD CONSTRAINT "HoursException_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursException" ADD CONSTRAINT "HoursException_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blackout" ADD CONSTRAINT "Blackout_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blackout" ADD CONSTRAINT "Blackout_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeakRule" ADD CONSTRAINT "PeakRule_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeakRule" ADD CONSTRAINT "PeakRule_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AddOn" ADD CONSTRAINT "AddOn_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTier" ADD CONSTRAINT "RefundTier_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundTier" ADD CONSTRAINT "RefundTier_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceMember" ADD CONSTRAINT "MakerspaceMember_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOccurrence" ADD CONSTRAINT "BookingOccurrence_bookingId_spaceId_fkey" FOREIGN KEY ("bookingId", "spaceId") REFERENCES "Booking"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingOccurrence" ADD CONSTRAINT "BookingOccurrence_makerspaceId_spaceId_fkey" FOREIGN KEY ("makerspaceId", "spaceId") REFERENCES "Space"("makerspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_makerspaceId_bookingId_fkey" FOREIGN KEY ("makerspaceId", "bookingId") REFERENCES "Booking"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_makerspaceId_occurrenceId_fkey" FOREIGN KEY ("makerspaceId", "occurrenceId") REFERENCES "BookingOccurrence"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Integrity rules Prisma cannot express ─────────────────────────────────

ALTER TABLE "MakerspaceBookingSettings"
  ADD CONSTRAINT "MakerspaceBookingSettings_ranges" CHECK (
    "requestExpiryHours" BETWEEN 1 AND 720 AND "approvalPayWithinHours" BETWEEN 1 AND 720
    AND "minDurationMinutes" BETWEEN 5 AND 43200 AND "maxDurationMinutes" BETWEEN "minDurationMinutes" AND 43200
    AND "slotStepMinutes" BETWEEN 5 AND 1440 AND "leadTimeMinutes" BETWEEN 0 AND 525600
    AND "advanceWindowDays" BETWEEN 1 AND 3650 AND "bufferBeforeMinutes" BETWEEN 0 AND 1440 AND "bufferAfterMinutes" BETWEEN 0 AND 1440
    AND "holdMinutes" BETWEEN 5 AND 120 AND "recurrenceMaxOccurrences" BETWEEN 1 AND 104
    AND "customerCancelCutoffHours" BETWEEN 0 AND 8760 AND "customerRescheduleCutoffHours" BETWEEN 0 AND 8760
    AND "selfCheckInOpensMinutesBefore" BETWEEN 0 AND 1440 AND "selfCheckInClosesMinutesAfter" BETWEEN 0 AND 1440
    AND "noShowGraceMinutes" BETWEEN 0 AND 1440 AND "depositPercentBps" BETWEEN 0 AND 10000 AND "depositFixedMinor" >= 0
    AND "payLaterDueHoursBeforeStart" BETWEEN 0 AND 8760 AND "payLaterDueDaysAfterBooking" BETWEEN 0 AND 365
    AND "payLaterMinWindowHours" BETWEEN 0 AND 720 AND "payLaterMinLeadHours" BETWEEN 0 AND 8760
  );

ALTER TABLE "Space"
  ADD CONSTRAINT "Space_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "Space_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "Space_counts" CHECK ("units" BETWEEN 1 AND 500 AND "capacity" BETWEEN 0 AND 100000 AND "sortOrder" >= 0),
  ADD CONSTRAINT "Space_rates_nonnegative" CHECK (
    coalesce("publicHourlyMinor", 0) >= 0 AND coalesce("publicHalfDayMinor", 0) >= 0 AND coalesce("publicDayMinor", 0) >= 0
    AND coalesce("memberHourlyMinor", 0) >= 0 AND coalesce("memberHalfDayMinor", 0) >= 0 AND coalesce("memberDayMinor", 0) >= 0
  ),
  ADD CONSTRAINT "Space_block_lengths" CHECK ("halfDayMinutes" BETWEEN 15 AND 1440 AND "dayMinutes" BETWEEN "halfDayMinutes" AND 1440),
  ADD CONSTRAINT "Space_tax_override" CHECK (("taxRateBps" IS NULL OR "taxRateBps" BETWEEN 0 AND 10000) AND ("sacCode" IS NULL OR "sacCode" ~ '^[0-9]{4,8}$')),
  ADD CONSTRAINT "Space_rule_overrides_object" CHECK (jsonb_typeof("ruleOverrides") = 'object');

ALTER TABLE "OpeningHours"
  ADD CONSTRAINT "OpeningHours_interval" CHECK ("weekday" BETWEEN 0 AND 6 AND "openMinute" >= 0 AND "closeMinute" <= 1440 AND "openMinute" < "closeMinute");

ALTER TABLE "HoursException"
  ADD CONSTRAINT "HoursException_intervals_array" CHECK (jsonb_typeof("intervals") = 'array' AND ("closed" = (jsonb_array_length("intervals") = 0)));

ALTER TABLE "Blackout"
  ADD CONSTRAINT "Blackout_shape" CHECK (
    ("startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "startsAt" IS NULL AND "endsAt" IS NULL AND "endDate" >= "startDate")
    OR ("startDate" IS NULL AND "endDate" IS NULL AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt")
  );

ALTER TABLE "PeakRule"
  ADD CONSTRAINT "PeakRule_window" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"),
  ADD CONSTRAINT "PeakRule_surcharge" CHECK ("surchargeBps" BETWEEN 1 AND 100000),
  ADD CONSTRAINT "PeakRule_weekdays" CHECK (cardinality("weekdays") BETWEEN 1 AND 7 AND "weekdays" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);

ALTER TABLE "AddOn"
  ADD CONSTRAINT "AddOn_prices" CHECK ("priceMinor" >= 0 AND ("memberPriceMinor" IS NULL OR "memberPriceMinor" >= 0)),
  ADD CONSTRAINT "AddOn_sac" CHECK ("sacCode" IS NULL OR "sacCode" ~ '^[0-9]{4,8}$'),
  ADD CONSTRAINT "AddOn_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120);

ALTER TABLE "RefundTier"
  ADD CONSTRAINT "RefundTier_ranges" CHECK ("minHoursBefore" BETWEEN 0 AND 8760 AND "refundBps" BETWEEN 0 AND 10000);

ALTER TABLE "MakerspaceMember"
  ADD CONSTRAINT "MakerspaceMember_email_lowercase" CHECK ("email" = lower("email") AND char_length("email") BETWEEN 3 AND 320);

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_reference_format" CHECK ("reference" ~ '^BK-[0-9A-HJKMNP-TV-Z]{6}$'),
  ADD CONSTRAINT "Booking_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Booking_contact" CHECK ("contactEmail" = lower("contactEmail") AND char_length("contactEmail") BETWEEN 3 AND 320 AND char_length(btrim("contactName")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "Booking_counts" CHECK ("quantity" >= 1 AND "attendees" >= 0),
  ADD CONSTRAINT "Booking_money_nonnegative" CHECK (
    "subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0 AND "depositMinor" >= 0 AND "depositMinor" <= "totalMinor"
    AND "chargeMinor" >= 0 AND "paidMinor" >= 0 AND "refundedMinor" >= 0
  ),
  ADD CONSTRAINT "Booking_hold_has_expiry" CHECK ("status" <> 'HELD' OR "holdExpiresAt" IS NOT NULL),
  ADD CONSTRAINT "Booking_decline_has_reason" CHECK ("status" <> 'DECLINED' OR length(btrim(coalesce("declineReason", ''))) > 0),
  ADD CONSTRAINT "Booking_cancel_has_kind" CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelKind" IS NOT NULL));

ALTER TABLE "BookingOccurrence"
  ADD CONSTRAINT "BookingOccurrence_times" CHECK ("endsAt" > "startsAt" AND "blockStart" <= "startsAt" AND "blockEnd" >= "endsAt" AND "policyAnchorAt" <= "startsAt"),
  ADD CONSTRAINT "BookingOccurrence_numbers" CHECK ("unit" >= 0 AND "slotIndex" >= 0 AND "priceMinor" >= 0 AND "keptFeeMinor" >= 0 AND "sequence" >= 0),
  ADD CONSTRAINT "BookingOccurrence_blocking_live" CHECK (NOT "blocking" OR "status" IN ('SCHEDULED', 'CHECKED_IN'));

-- Double booking is impossible: blocking rows of one unit of one space never overlap (buffers included).
ALTER TABLE "BookingOccurrence"
  ADD CONSTRAINT "BookingOccurrence_no_overlap" EXCLUDE USING gist (
    "spaceId" WITH =, "unit" WITH =, tstzrange("blockStart", "blockEnd", '[)') WITH &&
  ) WHERE ("blocking");

-- The timeline is append-only. Rows go only with their booking or makerspace (a makerspace being deleted).
CREATE FUNCTION booking_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
    NOT EXISTS (SELECT 1 FROM "Booking" WHERE "id" = OLD."bookingId")
    OR NOT EXISTS (SELECT 1 FROM "Makerspace" WHERE "id" = OLD."makerspaceId")
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Booking events are append-only' USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER "BookingEvent_guard" BEFORE UPDATE OR DELETE ON "BookingEvent" FOR EACH ROW EXECUTE FUNCTION booking_event_guard();
