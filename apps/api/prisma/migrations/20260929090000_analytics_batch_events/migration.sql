-- Батчевые события каталога (фаза 1, /api/e): page_view, gallery_open,
-- search_filter. Часть из них (page_view, часть search_filter) бывает без
-- анкеты — profileId становится необязательным.

-- AlterEnum
ALTER TYPE "ProfileEventKind" ADD VALUE 'page_view';
ALTER TYPE "ProfileEventKind" ADD VALUE 'gallery_open';
ALTER TYPE "ProfileEventKind" ADD VALUE 'search_filter';

-- AlterTable
ALTER TABLE "ProfileEvent" ALTER COLUMN "profileId" DROP NOT NULL;
ALTER TABLE "ProfileEvent" ADD COLUMN "path" TEXT;
