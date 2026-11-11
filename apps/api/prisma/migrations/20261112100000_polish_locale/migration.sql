-- Польский язык: названия справочников должны быть на каждой локали, иначе
-- API не соберёт перевод. Для уже существующих записей кладём временно
-- английское название; настоящие польские названия доезжают сидом справочника
-- (`db:seed:reference`), который заменяет такие запасные значения.
INSERT INTO "CountryTranslation" ("id", "countryId", "locale", "name")
SELECT md5(random()::text || t."id"), t."countryId", 'pl', t."name"
FROM "CountryTranslation" t
WHERE t."locale" = 'en'
  AND NOT EXISTS (SELECT 1 FROM "CountryTranslation" x WHERE x."countryId" = t."countryId" AND x."locale" = 'pl');

INSERT INTO "CityTranslation" ("id", "cityId", "locale", "name")
SELECT md5(random()::text || t."id"), t."cityId", 'pl', t."name"
FROM "CityTranslation" t
WHERE t."locale" = 'en'
  AND NOT EXISTS (SELECT 1 FROM "CityTranslation" x WHERE x."cityId" = t."cityId" AND x."locale" = 'pl');

INSERT INTO "DistrictTranslation" ("id", "districtId", "locale", "name")
SELECT md5(random()::text || t."id"), t."districtId", 'pl', t."name"
FROM "DistrictTranslation" t
WHERE t."locale" = 'en'
  AND NOT EXISTS (SELECT 1 FROM "DistrictTranslation" x WHERE x."districtId" = t."districtId" AND x."locale" = 'pl');

INSERT INTO "ServiceTranslation" ("id", "serviceId", "locale", "name")
SELECT md5(random()::text || t."id"), t."serviceId", 'pl', t."name"
FROM "ServiceTranslation" t
WHERE t."locale" = 'en'
  AND NOT EXISTS (SELECT 1 FROM "ServiceTranslation" x WHERE x."serviceId" = t."serviceId" AND x."locale" = 'pl');

INSERT INTO "ServiceGroupTranslation" ("id", "groupKey", "locale", "name")
SELECT md5(random()::text || t."id"), t."groupKey", 'pl', t."name"
FROM "ServiceGroupTranslation" t
WHERE t."locale" = 'en'
  AND NOT EXISTS (SELECT 1 FROM "ServiceGroupTranslation" x WHERE x."groupKey" = t."groupKey" AND x."locale" = 'pl');
