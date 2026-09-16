-- Тариф агентства по числу анкет (payments.md §3.3, D-13 — заменяет плоский
-- тариф D-07). AgencyTariffTier/AgencyTariffPrice заводятся пустыми: сетку
-- сеет и бэкфиллит существующие компании `seedAgencyTariffDefaults` при
-- первом чтении, как и остальная конфигурация монетизации — миграция не
-- должна хардкодить бизнес-значения.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "customPriceM12Gc" INTEGER,
ADD COLUMN     "customPriceM1Gc" INTEGER,
ADD COLUMN     "customPriceM6Gc" INTEGER,
ADD COLUMN     "customProfileLimit" INTEGER,
ADD COLUMN     "tariffTierId" TEXT;

-- CreateTable
CREATE TABLE "AgencyTariffTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "minProfiles" INTEGER NOT NULL,
    "maxProfiles" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyTariffTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyTariffPrice" (
    "tierId" TEXT NOT NULL,
    "term" "PlanTerm" NOT NULL,
    "gc" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyTariffPrice_pkey" PRIMARY KEY ("tierId","term")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyTariffTier_position_key" ON "AgencyTariffTier"("position");

-- CreateIndex
CREATE INDEX "AgencyTariffTier_minProfiles_maxProfiles_idx" ON "AgencyTariffTier"("minProfiles", "maxProfiles");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tariffTierId_fkey" FOREIGN KEY ("tariffTierId") REFERENCES "AgencyTariffTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyTariffPrice" ADD CONSTRAINT "AgencyTariffPrice_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "AgencyTariffTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
