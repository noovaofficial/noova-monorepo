-- CreateEnum
CREATE TYPE "AdvertiserKind" AS ENUM ('individual', 'salon');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "moderationNote" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "advertiserKind" "AdvertiserKind";
