-- Правка текста опубликованной анкеты, ждущая взгляда модератора.
CREATE TABLE "ProfileTextReview" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "previousDisplayName" TEXT NOT NULL,
    "previousDescription" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileTextReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfileTextReview_profileId_key" ON "ProfileTextReview"("profileId");
CREATE INDEX "ProfileTextReview_createdAt_idx" ON "ProfileTextReview"("createdAt");

ALTER TABLE "ProfileTextReview" ADD CONSTRAINT "ProfileTextReview_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
