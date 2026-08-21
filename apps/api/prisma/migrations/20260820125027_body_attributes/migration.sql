-- CreateEnum
CREATE TYPE "BodyType" AS ENUM ('slim', 'thin', 'athletic', 'normal', 'curvy');

-- CreateEnum
CREATE TYPE "BreastType" AS ENUM ('natural', 'silicone');

-- CreateEnum
CREATE TYPE "PubicHair" AS ENUM ('natural', 'trimmed', 'shaved');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "bodyType" "BodyType",
ADD COLUMN     "breastType" "BreastType",
ADD COLUMN     "hasPiercing" BOOLEAN,
ADD COLUMN     "hasTattoos" BOOLEAN,
ADD COLUMN     "pubicHair" "PubicHair";
