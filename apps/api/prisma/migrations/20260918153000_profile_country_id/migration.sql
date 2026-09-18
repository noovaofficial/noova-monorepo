-- Денормализация страны на анкету (N-43): фильтр «вся страна» на главной
-- и в каталоге читает эту колонку напрямую, без джойна через City.

-- AlterTable: колонка сперва nullable — иначе бэкфилл ниже не пройдёт.
ALTER TABLE "Profile" ADD COLUMN     "countryId" TEXT;

-- Бэкфилл существующих анкет страной их города.
UPDATE "Profile" p
SET "countryId" = c."countryId"
FROM "City" c
WHERE p."cityId" = c.id;

-- Теперь у каждой анкеты есть страна — можно закрыть NULL.
ALTER TABLE "Profile" ALTER COLUMN "countryId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Profile_status_kind_countryId_publishedAt_idx" ON "Profile"("status", "kind", "countryId", "publishedAt");
