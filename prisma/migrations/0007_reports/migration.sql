-- CreateTable
CREATE TABLE "OrgDailyStats" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "unitId" TEXT,
    "planId" TEXT,
    "active" INTEGER NOT NULL DEFAULT 0,
    "grace" INTEGER NOT NULL DEFAULT 0,
    "joined" INTEGER NOT NULL DEFAULT 0,
    "reactivated" INTEGER NOT NULL DEFAULT 0,
    "due" INTEGER NOT NULL DEFAULT 0,
    "renewed" INTEGER NOT NULL DEFAULT 0,
    "lapsed" INTEGER NOT NULL DEFAULT 0,
    "applications" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgStatsDirtyDay" (
    "organisationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgStatsDirtyDay_pkey" PRIMARY KEY ("organisationId","day")
);

-- CreateIndex
CREATE INDEX "OrgDailyStats_organisationId_day_idx" ON "OrgDailyStats"("organisationId", "day");

-- CreateIndex
CREATE INDEX "OrgDailyStats_day_idx" ON "OrgDailyStats"("day");

-- CreateIndex
CREATE INDEX "MembershipTerm_organisationId_createdAt_idx" ON "MembershipTerm"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrgDailyStats" ADD CONSTRAINT "OrgDailyStats_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgDailyStats" ADD CONSTRAINT "OrgDailyStats_organisationId_unitId_fkey" FOREIGN KEY ("organisationId", "unitId") REFERENCES "OrgUnit"("organisationId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrgDailyStats" ADD CONSTRAINT "OrgDailyStats_organisationId_planId_fkey" FOREIGN KEY ("organisationId", "planId") REFERENCES "MembershipPlan"("organisationId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "OrgStatsDirtyDay" ADD CONSTRAINT "OrgStatsDirtyDay_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
