-- Салон — это анкета, а не сущность рядом с ней (решение владельца продукта).
--
-- Раньше салон заполнял и компанию, и анкеты массажисток: одиннадцать полей
-- дублировались, а в каталоге сам салон не показывался вовсе. Теперь у салона
-- одна анкета, она же его страница в поиске.
--
-- Порядок здесь и есть суть: сначала колонки, потом перенос данных, и только
-- потом удаление старых. Обратный порядок стёр бы то, что переносим.

-- 1. Салонные поля на анкете
ALTER TABLE "Profile" ADD COLUMN "address" TEXT;
ALTER TABLE "Profile" ADD COLUMN "directions" TEXT;
ALTER TABLE "Profile" ADD COLUMN "minSessionMinutes" INTEGER;
ALTER TABLE "Profile" ADD COLUMN "bookingPolicy" "BookingPolicy";
ALTER TABLE "Profile" ADD COLUMN "payments" "PaymentMethod"[] DEFAULT ARRAY[]::"PaymentMethod"[];
ALTER TABLE "Profile" ADD COLUMN "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "ProfileHours" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opensAt" INTEGER,
    "closesAt" INTEGER,

    CONSTRAINT "ProfileHours_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProfileHours_profileId_weekday_key" ON "ProfileHours"("profileId", "weekday");
ALTER TABLE "ProfileHours" ADD CONSTRAINT "ProfileHours_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Переносим данные салонов на их старейшую анкету.
--    Старейшую, а не произвольную: она заведена первой и вероятнее всего и
--    есть основная витрина салона.
WITH target AS (
  SELECT DISTINCT ON (c.id)
         c.id AS company_id, p.id AS profile_id,
         c."address", c."directions", c."minSessionMinutes", c."bookingPolicy", c."payments", c."amenities"
  FROM "Company" c
  JOIN "Profile" p ON p."ownerId" = c."ownerId"
  WHERE c.kind = 'salon'
  ORDER BY c.id, p."createdAt" ASC
)
UPDATE "Profile" p
SET "address" = t."address",
    "directions" = t."directions",
    "minSessionMinutes" = t."minSessionMinutes",
    "bookingPolicy" = t."bookingPolicy",
    "payments" = t."payments",
    "amenities" = t."amenities"
FROM target t
WHERE p.id = t.profile_id;

INSERT INTO "ProfileHours" ("id", "profileId", "weekday", "opensAt", "closesAt")
SELECT gen_random_uuid()::text, t.profile_id, h."weekday", h."opensAt", h."closesAt"
FROM "CompanyHours" h
JOIN (
  SELECT DISTINCT ON (c.id) c.id AS company_id, p.id AS profile_id
  FROM "Company" c JOIN "Profile" p ON p."ownerId" = c."ownerId"
  WHERE c.kind = 'salon'
  ORDER BY c.id, p."createdAt" ASC
) t ON t.company_id = h."companyId";

-- 3. Компании салонов больше не нужны: их данные уехали на анкету.
DELETE FROM "Company" WHERE kind = 'salon';

-- 4. Старые колонки и таблицы
ALTER TABLE "Company" DROP COLUMN "address";
ALTER TABLE "Company" DROP COLUMN "directions";
ALTER TABLE "Company" DROP COLUMN "minSessionMinutes";
ALTER TABLE "Company" DROP COLUMN "bookingPolicy";
ALTER TABLE "Company" DROP COLUMN "amenities";
DROP TABLE "CompanyHours";
DROP TABLE "CompanyPrice";
