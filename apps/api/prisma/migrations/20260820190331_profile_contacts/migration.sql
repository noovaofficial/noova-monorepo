-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('phone', 'whatsapp', 'telegram', 'viber');

-- CreateTable
CREATE TABLE "ProfileContact" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactReveal" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "userId" TEXT,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactReveal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileContact_profileId_position_idx" ON "ProfileContact"("profileId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileContact_profileId_type_value_key" ON "ProfileContact"("profileId", "type", "value");

-- CreateIndex
CREATE INDEX "ContactReveal_profileId_createdAt_idx" ON "ContactReveal"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactReveal_createdAt_idx" ON "ContactReveal"("createdAt");

-- AddForeignKey
ALTER TABLE "ProfileContact" ADD CONSTRAINT "ProfileContact_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactReveal" ADD CONSTRAINT "ContactReveal_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
