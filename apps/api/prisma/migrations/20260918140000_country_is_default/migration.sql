-- Страна по умолчанию: куда вести корень сайта без запомненного выбора.
-- Ровно одна активная страна с isDefault=true — обеспечивается в коде
-- роута (транзакция), а не ограничением БД.

-- AlterTable
ALTER TABLE "Country" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;
