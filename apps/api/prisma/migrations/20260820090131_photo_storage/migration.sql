-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "bytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "variants" JSONB;

-- CreateIndex
CREATE INDEX "Photo_deletedAt_idx" ON "Photo"("deletedAt");
