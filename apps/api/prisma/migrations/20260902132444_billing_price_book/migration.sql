-- Монетизация, этап 1 (payments.md §5, §8): конфигурация прайса и модель
-- данных биллинга. Таблицы конфигурации (BillingSettings, PriceBookEntry,
-- TopupTier) намеренно пустые — значения из документа кладёт первое чтение
-- `loadBillingConfig`, а не миграция: конфигурация правится из админки и
-- в код возвращаться не должна.
--
-- BillingTransaction и Listing заводятся сейчас, хотя пишут в них этапы 2–3:
-- баланс без журнала — состояние, которое нечем восстановить, и добавлять
-- журнал поверх уже накопленных балансов было бы поздно.

-- CreateEnum
CREATE TYPE "PlanTerm" AS ENUM ('m1', 'm6', 'm12');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('active', 'grace', 'expired', 'pending_topup');

-- CreateEnum
CREATE TYPE "BillingTransactionKind" AS ENUM ('TOPUP', 'SPEND', 'RENEWAL', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "glowcoinBalance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "gcPerEur" DOUBLE PRECISION NOT NULL,
    "agencyProfileLimit" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBookEntry" (
    "kind" "AdvertiserKind" NOT NULL,
    "term" "PlanTerm" NOT NULL,
    "gc" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceBookEntry_pkey" PRIMARY KEY ("kind","term")
);

-- CreateTable
CREATE TABLE "TopupTier" (
    "eur" INTEGER NOT NULL,
    "bonusPercent" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopupTier_pkey" PRIMARY KEY ("eur")
);

-- CreateTable
CREATE TABLE "BillingTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "BillingTransactionKind" NOT NULL,
    "gcAmount" INTEGER NOT NULL,
    "eurPaidCents" INTEGER,
    "bonusPercent" INTEGER,
    "provider" TEXT,
    "providerRef" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AdvertiserKind" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'active',
    "term" "PlanTerm" NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingTransaction_userId_createdAt_idx" ON "BillingTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingTransaction_provider_providerRef_key" ON "BillingTransaction"("provider", "providerRef");

-- CreateIndex
CREATE INDEX "Listing_userId_status_idx" ON "Listing"("userId", "status");

-- CreateIndex
CREATE INDEX "Listing_status_expiresAt_idx" ON "Listing"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingTransaction" ADD CONSTRAINT "BillingTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
