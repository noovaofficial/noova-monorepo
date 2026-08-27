-- CreateTable
CREATE TABLE "CompanyHours" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensAt" INTEGER,
    "closesAt" INTEGER,

    CONSTRAINT "CompanyHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHours_companyId_weekday_key" ON "CompanyHours"("companyId", "weekday");

-- AddForeignKey
ALTER TABLE "CompanyHours" ADD CONSTRAINT "CompanyHours_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
