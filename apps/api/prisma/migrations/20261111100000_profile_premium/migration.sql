-- Premium: подписка в месте с бесплатным размещением даёт значок и приоритет.
ALTER TABLE "Profile" ADD COLUMN "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- Первичный пересчёт: у владельца действует подписка (активная или в льготных
-- днях), а правило страны для его типа говорит «бесплатно и разрешено».
UPDATE "Profile" p
SET "isPremium" = true
FROM "User" u
WHERE p."ownerId" = u."id"
  AND EXISTS (
    SELECT 1 FROM "Listing" l
    WHERE l."userId" = u."id" AND l."status" IN ('active', 'grace')
  )
  AND EXISTS (
    SELECT 1 FROM "PlacementRule" r
    WHERE r."countryId" = p."countryId" AND r."kind" = u."advertiserKind"
      AND r."paid" = false AND COALESCE(r."allowed", true)
  );
