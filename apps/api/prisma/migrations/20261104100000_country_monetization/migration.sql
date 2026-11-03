-- Монетизация по странам и городам: цены размещения, ТОП, сетка тарифов
-- агентств. Общих значений больше нет — текущие общие копируются в каждую
-- существующую страну, чтобы после выката цены не изменились.

-- Курс страны убран (он нигде не использовался). IF EXISTS: в первой версии
-- миграции placement_rules_currency колонка была и могла уже оказаться в базе.
ALTER TABLE "Country" DROP COLUMN IF EXISTS "eurRate";

-- Новые таблицы
CREATE TABLE "CountryTopSetting" (
    "countryId" TEXT NOT NULL,
    "weekGc" INTEGER NOT NULL,
    "slots" INTEGER NOT NULL,
    "agencyWeekGc" INTEGER NOT NULL,
    "agencySlots" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryTopSetting_pkey" PRIMARY KEY ("countryId")
);

CREATE TABLE "CountryPlacementPrice" (
    "countryId" TEXT NOT NULL,
    "kind" "AdvertiserKind" NOT NULL,
    "term" "PlanTerm" NOT NULL,
    "gc" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryPlacementPrice_pkey" PRIMARY KEY ("countryId","kind","term")
);

CREATE TABLE "CityPlacementPrice" (
    "cityId" TEXT NOT NULL,
    "kind" "AdvertiserKind" NOT NULL,
    "term" "PlanTerm" NOT NULL,
    "gc" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityPlacementPrice_pkey" PRIMARY KEY ("cityId","kind","term")
);

ALTER TABLE "CountryTopSetting" ADD CONSTRAINT "CountryTopSetting_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CountryPlacementPrice" ADD CONSTRAINT "CountryPlacementPrice_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CityPlacementPrice" ADD CONSTRAINT "CityPlacementPrice_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Цены размещения: общий прайс → каждой стране. Таблица прайса могла быть
-- ещё пуста (её заполняет первое чтение) — тогда берём значения из
-- payments.md, те же, что подставляло приложение.
INSERT INTO "CountryPlacementPrice" ("countryId", "kind", "term", "gc", "updatedAt")
SELECT c."id", d."kind"::"AdvertiserKind", d."term"::"PlanTerm", COALESCE(pb."gc", d."gc"), NOW()
FROM "Country" c
CROSS JOIN (VALUES
    ('individual', 'm1', 170), ('individual', 'm6', 690),  ('individual', 'm12', 990),
    ('salon',      'm1', 490), ('salon',      'm6', 1990), ('salon',      'm12', 2990),
    ('agency',     'm1', 990), ('agency',     'm6', 3990), ('agency',     'm12', 5990)
) AS d("kind", "term", "gc")
LEFT JOIN "PriceBookEntry" pb
  ON pb."kind" = d."kind"::"AdvertiserKind" AND pb."term" = d."term"::"PlanTerm";

-- ТОП: общие цена и места → каждой стране (и анкет, и агентств).
INSERT INTO "CountryTopSetting" ("countryId", "weekGc", "slots", "agencyWeekGc", "agencySlots", "updatedAt")
SELECT c."id",
       COALESCE(s."topWeekGc", 300), COALESCE(s."topSlots", 16),
       COALESCE(s."agencyTopWeekGc", 300), COALESCE(s."agencyTopSlots", 8),
       NOW()
FROM "Country" c
LEFT JOIN "BillingSettings" s ON s."id" = 'default';

-- Страна компании: по большинству её анкет, иначе страна по умолчанию,
-- иначе любая (самая ранняя по коду) — чтобы поле не осталось пустым.
ALTER TABLE "Company" ADD COLUMN "countryId" TEXT;

UPDATE "Company" co
SET "countryId" = COALESCE(
    (SELECT p."countryId"
       FROM "Profile" p
      WHERE p."companyId" = co."id"
      GROUP BY p."countryId"
      ORDER BY COUNT(*) DESC, p."countryId"
      LIMIT 1),
    (SELECT "id" FROM "Country" WHERE "isDefault" ORDER BY "code" LIMIT 1),
    (SELECT "id" FROM "Country" ORDER BY "code" LIMIT 1)
);

ALTER TABLE "Company" ADD CONSTRAINT "Company_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Сетка тарифов агентств: копия на каждую страну, компании переезжают на
-- копию своей страны.
DROP INDEX "AgencyTariffTier_position_key";
ALTER TABLE "AgencyTariffTier" ADD COLUMN "countryId" TEXT;

CREATE TEMP TABLE "_tier_map" AS
SELECT t."id" AS "oldId", c."id" AS "countryId", md5(t."id" || ':' || c."id") AS "newId"
FROM "AgencyTariffTier" t
CROSS JOIN "Country" c
WHERE t."countryId" IS NULL;

INSERT INTO "AgencyTariffTier"
    ("id", "name", "countryId", "position", "minProfiles", "maxProfiles", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT m."newId", t."name", m."countryId", t."position", t."minProfiles", t."maxProfiles",
       t."isDefault", t."isActive", t."createdAt", NOW()
FROM "_tier_map" m
JOIN "AgencyTariffTier" t ON t."id" = m."oldId";

INSERT INTO "AgencyTariffPrice" ("tierId", "term", "gc", "updatedAt")
SELECT m."newId", p."term", p."gc", NOW()
FROM "_tier_map" m
JOIN "AgencyTariffPrice" p ON p."tierId" = m."oldId";

UPDATE "Company" co
SET "tariffTierId" = m."newId"
FROM "_tier_map" m
WHERE co."tariffTierId" = m."oldId" AND co."countryId" = m."countryId";

DELETE FROM "AgencyTariffTier" WHERE "countryId" IS NULL;
DROP TABLE "_tier_map";

ALTER TABLE "AgencyTariffTier" ALTER COLUMN "countryId" SET NOT NULL;
CREATE UNIQUE INDEX "AgencyTariffTier_countryId_position_key" ON "AgencyTariffTier"("countryId", "position");
ALTER TABLE "AgencyTariffTier" ADD CONSTRAINT "AgencyTariffTier_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Общие значения убираем.
ALTER TABLE "BillingSettings" DROP COLUMN "agencyTopSlots",
DROP COLUMN "agencyTopWeekGc",
DROP COLUMN "topSlots",
DROP COLUMN "topWeekGc";

DROP TABLE "PriceBookEntry";
