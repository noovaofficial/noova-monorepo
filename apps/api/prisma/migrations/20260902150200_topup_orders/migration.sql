-- CreateEnum
CREATE TYPE "TopupOrderStatus" AS ENUM ('created', 'pending', 'paid', 'expired', 'canceled', 'failed');

-- CreateTable
CREATE TABLE "TopupOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eurCents" INTEGER NOT NULL,
    "bonusPercent" INTEGER NOT NULL,
    "gcPerEur" DOUBLE PRECISION NOT NULL,
    "grantedGc" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paymento',
    "providerToken" TEXT,
    "providerStatus" INTEGER,
    "status" "TopupOrderStatus" NOT NULL DEFAULT 'created',
    "transactionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopupOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopupOrder_providerToken_key" ON "TopupOrder"("providerToken");

-- CreateIndex
CREATE UNIQUE INDEX "TopupOrder_transactionId_key" ON "TopupOrder"("transactionId");

-- CreateIndex
CREATE INDEX "TopupOrder_userId_createdAt_idx" ON "TopupOrder"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TopupOrder" ADD CONSTRAINT "TopupOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopupOrder" ADD CONSTRAINT "TopupOrder_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BillingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
