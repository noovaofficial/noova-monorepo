-- CreateEnum
CREATE TYPE "TopPlacementStatus" AS ENUM ('active', 'expired');

-- AlterEnum
ALTER TYPE "BillingTransactionKind" ADD VALUE 'TOP';

-- AlterTable
ALTER TABLE "BillingSettings" ADD COLUMN     "topShown" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "topSlots" INTEGER NOT NULL DEFAULT 16,
ADD COLUMN     "topWeekGc" INTEGER NOT NULL DEFAULT 300;

-- CreateTable
CREATE TABLE "TopPlacement" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "TopPlacementStatus" NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopPlacement_profileId_key" ON "TopPlacement"("profileId");

-- CreateIndex
CREATE INDEX "TopPlacement_status_expiresAt_idx" ON "TopPlacement"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "TopPlacement" ADD CONSTRAINT "TopPlacement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopPlacement" ADD CONSTRAINT "TopPlacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
