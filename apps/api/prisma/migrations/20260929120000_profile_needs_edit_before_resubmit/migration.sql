-- Флаг «анкету отклонили, правок после отказа ещё не было» — заменяет
-- ненадёжное сравнение Profile.updatedAt с VerificationCase.reviewedAt
-- (обе метки бьёт сам отказ в одной транзакции, порядок не гарантирован).

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "needsEditBeforeResubmit" BOOLEAN NOT NULL DEFAULT false;
