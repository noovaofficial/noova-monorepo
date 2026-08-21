-- CreateEnum
CREATE TYPE "ProfileReportReason" AS ENUM ('underage', 'coercion', 'stolen_photos', 'impersonation', 'illegal_services', 'spam', 'other');

-- CreateTable
CREATE TABLE "ProfileReport" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "reporterId" TEXT,
    "ipHash" TEXT NOT NULL,
    "reason" "ProfileReportReason" NOT NULL,
    "details" VARCHAR(1000) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileReport_resolvedAt_createdAt_idx" ON "ProfileReport"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ProfileReport_profileId_createdAt_idx" ON "ProfileReport"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfileReport" ADD CONSTRAINT "ProfileReport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileReport" ADD CONSTRAINT "ProfileReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
