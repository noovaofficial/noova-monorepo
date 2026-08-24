-- Страна как сущность (N-32). Раньше страна была полем `City.countryCode`,
-- и завести её из админки, а тем более перевести, было нельзя.
--
-- Миграция написана руками, а не сгенерирована: `countryId` обязателен, а в
-- `City` уже есть строки — автоматика такой шаг выполнить не может. Порядок
-- здесь и есть суть: сначала создать страны из существующих кодов, потом
-- связать города, и только потом убрать старую колонку.

-- 1. Новые таблицы
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CountryTranslation" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "CountryTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");
CREATE UNIQUE INDEX "CountryTranslation_countryId_locale_key" ON "CountryTranslation"("countryId", "locale");

ALTER TABLE "CountryTranslation" ADD CONSTRAINT "CountryTranslation_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Страны из кодов, уже встречающихся у городов.
--    `name` временно равно коду: настоящее имя и переводы проставит
--    db:seed:reference, он идемпотентен и знает справочник.
INSERT INTO "Country" ("id", "code", "name")
SELECT gen_random_uuid()::text, "countryCode", "countryCode"
FROM (SELECT DISTINCT "countryCode" FROM "City") AS codes;

-- 3. Связываем города: колонку добавляем необязательной, заполняем, и только
--    потом делаем обязательной — обратный порядок упал бы на существующих строках.
ALTER TABLE "City" ADD COLUMN "countryId" TEXT;
UPDATE "City" SET "countryId" = "Country"."id"
FROM "Country" WHERE "Country"."code" = "City"."countryCode";
ALTER TABLE "City" ALTER COLUMN "countryId" SET NOT NULL;

DROP INDEX IF EXISTS "City_countryCode_idx";
ALTER TABLE "City" DROP COLUMN "countryCode";

CREATE INDEX "City_countryId_idx" ON "City"("countryId");
ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey"
    FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Отключение вместо удаления: на город и район ссылаются анкеты.
ALTER TABLE "City" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "District" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
