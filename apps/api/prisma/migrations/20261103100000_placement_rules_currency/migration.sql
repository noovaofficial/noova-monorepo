-- Валюта цен анкет страны
ALTER TABLE "Country" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'EUR';

-- Правила размещения по странам и городам
CREATE TABLE "PlacementRule" (
    "id" TEXT NOT NULL,
    "countryId" TEXT,
    "cityId" TEXT,
    "kind" "AdvertiserKind" NOT NULL,
    "paid" BOOLEAN,
    "allowed" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlacementRule_scope_check" CHECK (("countryId" IS NULL) <> ("cityId" IS NULL))
);

CREATE UNIQUE INDEX "PlacementRule_countryId_kind_key" ON "PlacementRule"("countryId", "kind");
CREATE UNIQUE INDEX "PlacementRule_cityId_kind_key" ON "PlacementRule"("cityId", "kind");

ALTER TABLE "PlacementRule" ADD CONSTRAINT "PlacementRule_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlacementRule" ADD CONSTRAINT "PlacementRule_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;
