-- Салон перестал быть компанией (см. 20260827180000_salon_is_profile), и
-- значение `salon` в перечислении осталось без носителей. Убираем, чтобы тип
-- в коде совпадал со схемой: иначе Prisma отдаёт 'agency' | 'salon', а
-- контракт ждёт только 'agency'.
--
-- Переименование enum, а не ALTER TYPE ... DROP VALUE: Postgres удалять
-- значения перечисления не умеет.
ALTER TYPE "CompanyKind" RENAME TO "CompanyKind_old";
CREATE TYPE "CompanyKind" AS ENUM ('agency');
ALTER TABLE "Company" ALTER COLUMN "kind" TYPE "CompanyKind" USING ("kind"::text::"CompanyKind");
DROP TYPE "CompanyKind_old";
