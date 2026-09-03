-- Акции: что выдаём, кому и при каком условии (решение админа).

-- CreateEnum
CREATE TYPE "CampaignTrigger" AS ENUM ('first_profile', 'promo_code');

-- AlterTable
-- Срок размещения становится необязательным: у выданного акцией срока нет.
-- Подставлять сюда «месяц» значило бы записать покупку, которой не было.
ALTER TABLE "Listing" ALTER COLUMN "term" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "CampaignTrigger" NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "cityId" TEXT,
    "advertiserKind" "AdvertiserKind",
    "quota" INTEGER,
    "rewardGc" INTEGER NOT NULL DEFAULT 0,
    "rewardListingDays" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignGrant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedGc" INTEGER NOT NULL,
    "grantedDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");
CREATE INDEX "Campaign_trigger_isActive_idx" ON "Campaign"("trigger", "isActive");

-- CreateIndex
-- Пара «акция + человек» уникальна: она же счётчик квоты и она же запрет
-- повторной выдачи — на уровне БД, а не на уровне внимательности кода.
CREATE UNIQUE INDEX "CampaignGrant_campaignId_userId_key" ON "CampaignGrant"("campaignId", "userId");
CREATE INDEX "CampaignGrant_campaignId_createdAt_idx" ON "CampaignGrant"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CampaignGrant" ADD CONSTRAINT "CampaignGrant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignGrant" ADD CONSTRAINT "CampaignGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
