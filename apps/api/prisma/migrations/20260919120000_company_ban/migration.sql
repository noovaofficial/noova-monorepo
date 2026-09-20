-- Блокировка агентства модератором/админом — независимо от `isActive`,
-- которым распоряжается сам владелец.

-- AlterEnum
ALTER TYPE "ModerationSubject" ADD VALUE 'company';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "bannedAt" TIMESTAMP(3),
ADD COLUMN "banReason" TEXT;
