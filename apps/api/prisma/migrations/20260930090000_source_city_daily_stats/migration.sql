-- Роллапы фазы 4: источники трафика и спрос по городам.

-- CreateTable
CREATE TABLE "SourceDailyStat" (
    "day" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "sessions" INTEGER NOT NULL,
    "botSessions" INTEGER NOT NULL,
    "contacts" INTEGER NOT NULL,

    CONSTRAINT "SourceDailyStat_pkey" PRIMARY KEY ("day","source","network","utmCampaign")
);

-- CreateIndex
CREATE INDEX "SourceDailyStat_day_idx" ON "SourceDailyStat"("day");

-- CreateTable
CREATE TABLE "CityDailyStat" (
    "day" DATE NOT NULL,
    "city" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "profileViews" INTEGER NOT NULL,
    "contacts" INTEGER NOT NULL,
    "activeProfiles" INTEGER NOT NULL,

    CONSTRAINT "CityDailyStat_pkey" PRIMARY KEY ("day","city","category")
);

-- CreateIndex
CREATE INDEX "CityDailyStat_day_idx" ON "CityDailyStat"("day");
