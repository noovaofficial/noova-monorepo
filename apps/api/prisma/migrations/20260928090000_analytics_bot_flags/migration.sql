-- Разметка ботов (фаза 3): помечаем, не удаляем.

-- AlterTable
ALTER TABLE "ProfileEvent" ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "botReason" TEXT;

-- AlterTable
ALTER TABLE "AnalyticsSession" ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "botReason" TEXT;
