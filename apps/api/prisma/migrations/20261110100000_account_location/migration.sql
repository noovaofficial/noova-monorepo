-- Страна и основной город аккаунта рекламодателя (вариант B): страна
-- выбирается при регистрации, город подставляется в новые анкеты.
ALTER TABLE "User" ADD COLUMN "countryId" TEXT;
ALTER TABLE "User" ADD COLUMN "cityId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Основной город — город самой свежей анкеты (у агентства он тоже подставится,
-- как удобное значение по умолчанию; менять его можно в настройках).
UPDATE "User" u
SET "cityId" = (
    SELECT p."cityId" FROM "Profile" p
    WHERE p."ownerId" = u."id"
    ORDER BY p."createdAt" DESC, p."id" DESC
    LIMIT 1
)
WHERE u."role" = 'advertiser';

-- Страна: у агентства — страна компании (на ней уже сидят тарифы и ТОП);
-- иначе — страна основного города, затем страна самой свежей анкеты, затем
-- страна по умолчанию. Рекламодателей без анкет и компании это тоже закрывает.
UPDATE "User" u
SET "countryId" = COALESCE(
    (SELECT c."countryId" FROM "Company" c WHERE c."ownerId" = u."id" AND u."advertiserKind" = 'agency'),
    (SELECT ci."countryId" FROM "City" ci WHERE ci."id" = u."cityId"),
    (SELECT p."countryId" FROM "Profile" p WHERE p."ownerId" = u."id" ORDER BY p."createdAt" DESC, p."id" DESC LIMIT 1),
    (SELECT "id" FROM "Country" WHERE "isDefault" ORDER BY "code" LIMIT 1),
    (SELECT "id" FROM "Country" ORDER BY "code" LIMIT 1)
)
WHERE u."role" = 'advertiser';

-- Основной город должен лежать в стране аккаунта: у агентства страна компании
-- могла разойтись со страной свежей анкеты.
UPDATE "User" u
SET "cityId" = NULL
WHERE u."cityId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "City" ci WHERE ci."id" = u."cityId" AND ci."countryId" = u."countryId");
