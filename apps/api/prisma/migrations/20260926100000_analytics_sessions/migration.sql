-- Сессии посетителей и атрибуция источника; сессия, город и категория в журнале событий.

-- AlterTable
ALTER TABLE "ProfileEvent" ADD COLUMN "sessionId" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "category" TEXT;

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "network" TEXT,
    "networkClickId" TEXT,
    "referrerHost" TEXT,
    "source" TEXT NOT NULL,
    "landingPath" TEXT NOT NULL,
    "deviceType" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_idx" ON "AnalyticsSession"("startedAt");

-- CreateIndex
CREATE INDEX "ProfileEvent_sessionId_idx" ON "ProfileEvent"("sessionId");
