-- ТОП агентств (payments.md §3.5, D-14): своя таблица мест, зеркало
-- TopPlacement, но на Company — свой пул, отдельный от ТОПа анкет.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BillingSettings" ADD COLUMN     "agencyTopSlots" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "agencyTopWeekGc" INTEGER NOT NULL DEFAULT 300;

-- CreateTable
CREATE TABLE "AgencyTopPlacement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "TopPlacementStatus" NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyTopPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyTopPlacement_companyId_key" ON "AgencyTopPlacement"("companyId");

-- CreateIndex
CREATE INDEX "AgencyTopPlacement_status_expiresAt_idx" ON "AgencyTopPlacement"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "AgencyTopPlacement" ADD CONSTRAINT "AgencyTopPlacement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyTopPlacement" ADD CONSTRAINT "AgencyTopPlacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
