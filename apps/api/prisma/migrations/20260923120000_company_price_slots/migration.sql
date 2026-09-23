-- Прайс агентства: копируется в анкету при её создании.

-- CreateTable
CREATE TABLE "CompanyPriceSlot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "incallCents" INTEGER,
    "outcallCents" INTEGER,

    CONSTRAINT "CompanyPriceSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPriceSlot_companyId_durationMinutes_key" ON "CompanyPriceSlot"("companyId", "durationMinutes");

-- AddForeignKey
ALTER TABLE "CompanyPriceSlot" ADD CONSTRAINT "CompanyPriceSlot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
