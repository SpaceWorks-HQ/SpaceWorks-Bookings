-- CreateTable
CREATE TABLE "MakerspaceDailyStats" (
    "id" TEXT NOT NULL,
    "makerspaceId" TEXT NOT NULL,
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

    CONSTRAINT "MakerspaceDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MakerspaceStatsDirtyDay" (
    "makerspaceId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MakerspaceStatsDirtyDay_pkey" PRIMARY KEY ("makerspaceId","day")
);

-- CreateIndex
CREATE INDEX "MakerspaceDailyStats_makerspaceId_day_idx" ON "MakerspaceDailyStats"("makerspaceId", "day");

-- CreateIndex
CREATE INDEX "MakerspaceDailyStats_day_idx" ON "MakerspaceDailyStats"("day");

-- CreateIndex
CREATE INDEX "MembershipTerm_makerspaceId_createdAt_idx" ON "MembershipTerm"("makerspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "MakerspaceDailyStats" ADD CONSTRAINT "MakerspaceDailyStats_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MakerspaceDailyStats" ADD CONSTRAINT "MakerspaceDailyStats_makerspaceId_unitId_fkey" FOREIGN KEY ("makerspaceId", "unitId") REFERENCES "MakerspaceUnit"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MakerspaceDailyStats" ADD CONSTRAINT "MakerspaceDailyStats_makerspaceId_planId_fkey" FOREIGN KEY ("makerspaceId", "planId") REFERENCES "MembershipPlan"("makerspaceId", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MakerspaceStatsDirtyDay" ADD CONSTRAINT "MakerspaceStatsDirtyDay_makerspaceId_fkey" FOREIGN KEY ("makerspaceId") REFERENCES "Makerspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
