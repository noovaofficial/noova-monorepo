-- DropIndex
DROP INDEX "Service_group_idx";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "appliesTo" "ListingKind"[] DEFAULT ARRAY[]::"ListingKind"[],
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Service_group_position_idx" ON "Service"("group", "position");
