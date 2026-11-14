-- Видео анкеты: одно на анкету, только при действующей подписке.

-- AlterEnum: решения по видео пишутся в журнал модерации своим видом.
ALTER TYPE "ModerationSubject" ADD VALUE 'video';

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'processing',
    "storageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "rejectedReason" TEXT,
    "failReason" TEXT,
    "claimedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Video_profileId_idx" ON "Video"("profileId");

-- CreateIndex
CREATE INDEX "Video_status_claimedAt_idx" ON "Video"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "Video_isApproved_status_idx" ON "Video"("isApproved", "status");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
