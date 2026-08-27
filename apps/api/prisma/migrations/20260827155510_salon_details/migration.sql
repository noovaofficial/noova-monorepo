-- CreateEnum
CREATE TYPE "BookingPolicy" AS ENUM ('appointment', 'walk_in');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'transfer');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bookingPolicy" "BookingPolicy",
ADD COLUMN     "directions" TEXT,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "minSessionMinutes" INTEGER,
ADD COLUMN     "payments" "PaymentMethod"[] DEFAULT ARRAY[]::"PaymentMethod"[];

-- CreateTable
CREATE TABLE "CompanyPrice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompanyPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyPrice_companyId_position_idx" ON "CompanyPrice"("companyId", "position");

-- AddForeignKey
ALTER TABLE "CompanyPrice" ADD CONSTRAINT "CompanyPrice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
