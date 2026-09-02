-- Журнал раскрытий становится общим журналом событий анкеты (аналитика).
-- Переименование, а не новая таблица рядом: накопленные раскрытия — это
-- статистика откликов за год, и терять её ради формы записи нельзя.

-- CreateEnum
CREATE TYPE "ProfileEventKind" AS ENUM ('view', 'favorite', 'contact_reveal', 'contact_click');

-- RenameTable
ALTER TABLE "ContactReveal" RENAME TO "ProfileEvent";
ALTER TABLE "ProfileEvent" RENAME CONSTRAINT "ContactReveal_pkey" TO "ProfileEvent_pkey";
ALTER TABLE "ProfileEvent" RENAME CONSTRAINT "ContactReveal_profileId_fkey" TO "ProfileEvent_profileId_fkey";
ALTER INDEX "ContactReveal_createdAt_idx" RENAME TO "ProfileEvent_createdAt_idx";

-- AlterTable
-- Значение по умолчанию — только на время заполнения: все накопленные строки
-- были раскрытиями, другого события в этой таблице не существовало. Дальше
-- умолчание снимается: вид события всегда указывает тот, кто его пишет.
ALTER TABLE "ProfileEvent" ADD COLUMN "kind" "ProfileEventKind" NOT NULL DEFAULT 'contact_reveal';
ALTER TABLE "ProfileEvent" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "ProfileEvent" ADD COLUMN "contactType" "ContactType";

-- CreateIndex
-- Прежний индекс (профиль, время) поглощён новым: тот начинается с того же
-- profileId, а запросы статистики всегда указывают ещё и вид события.
DROP INDEX "ContactReveal_profileId_createdAt_idx";
CREATE INDEX "ProfileEvent_profileId_kind_createdAt_idx" ON "ProfileEvent"("profileId", "kind", "createdAt");
