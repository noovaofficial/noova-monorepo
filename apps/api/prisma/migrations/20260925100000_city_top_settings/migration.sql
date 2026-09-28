-- Свои цена и число мест ТОПа для каждого города.

-- CreateTable
CREATE TABLE "CityTopSetting" (
    "cityId" TEXT NOT NULL,
    "weekGc" INTEGER,
    "slots" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityTopSetting_pkey" PRIMARY KEY ("cityId")
);

-- AddForeignKey
ALTER TABLE "CityTopSetting" ADD CONSTRAINT "CityTopSetting_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
