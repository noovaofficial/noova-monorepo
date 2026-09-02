-- AlterEnum
ALTER TYPE "TopupOrderStatus" ADD VALUE 'partial';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);
