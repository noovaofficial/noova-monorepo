-- CreateEnum
CREATE TYPE "VerificationRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "faceKey" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "togetherKey" TEXT NOT NULL,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRequest_status_submittedAt_idx" ON "VerificationRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_profileId_submittedAt_idx" ON "VerificationRequest"("profileId", "submittedAt");

-- AddForeignKey
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
