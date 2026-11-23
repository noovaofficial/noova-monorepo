-- Журнал просмотров снимков документов верификации.
CREATE TABLE "VerificationPhotoView" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "viewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationPhotoView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationPhotoView_requestId_createdAt_idx" ON "VerificationPhotoView"("requestId", "createdAt");
CREATE INDEX "VerificationPhotoView_viewerId_createdAt_idx" ON "VerificationPhotoView"("viewerId", "createdAt");

ALTER TABLE "VerificationPhotoView" ADD CONSTRAINT "VerificationPhotoView_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationPhotoView" ADD CONSTRAINT "VerificationPhotoView_viewerId_fkey"
    FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
