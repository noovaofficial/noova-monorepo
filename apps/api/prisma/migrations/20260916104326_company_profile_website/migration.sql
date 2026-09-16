-- Ссылка на сайт агентства и салона — отдельным полем, а не ещё одним типом
-- в ContactType: контакты это каналы связи (нормализуются как телефон/ник),
-- сайт — просто URL, и мешать их в одном списке/нормализации неверно.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "website" TEXT;
