-- Чистка после D-09 (автопродления нет): колонка Listing.autoRenew и
-- значения ListingStatus.pending_topup, BillingTransactionKind.RENEWAL
-- больше ничем не читаются и не пишутся.
--
-- Значения перечисления Postgres удалять не умеет, поэтому тип
-- пересоздаётся с приведением — как в 20260827190000_company_kind_agency.
-- Строк с удаляемыми значениями нет: RENEWAL никогда не писался, а в
-- pending_topup листинг не переводился.
--
-- Разнесено на два выпуска намеренно (documentation/deploy/prod.md §5):
-- образ ДО этой чистки читает `autoRenew` и на схеме без неё падает.

-- AlterEnum
BEGIN;
CREATE TYPE "BillingTransactionKind_new" AS ENUM ('TOPUP', 'SPEND', 'ADJUSTMENT', 'TOP');
ALTER TABLE "BillingTransaction" ALTER COLUMN "kind" TYPE "BillingTransactionKind_new" USING ("kind"::text::"BillingTransactionKind_new");
ALTER TYPE "BillingTransactionKind" RENAME TO "BillingTransactionKind_old";
ALTER TYPE "BillingTransactionKind_new" RENAME TO "BillingTransactionKind";
DROP TYPE "public"."BillingTransactionKind_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ListingStatus_new" AS ENUM ('active', 'grace', 'expired');
ALTER TABLE "public"."Listing" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Listing" ALTER COLUMN "status" TYPE "ListingStatus_new" USING ("status"::text::"ListingStatus_new");
ALTER TYPE "ListingStatus" RENAME TO "ListingStatus_old";
ALTER TYPE "ListingStatus_new" RENAME TO "ListingStatus";
DROP TYPE "public"."ListingStatus_old";
ALTER TABLE "Listing" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;

-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "autoRenew";

