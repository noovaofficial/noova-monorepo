-- Потолок разовой корректировки баланса для модератора (по модулю).
-- Раньше баланс правил только админ, и потолок был не нужен.
ALTER TABLE "BillingSettings" ADD COLUMN "moderatorAdjustLimitGc" INTEGER NOT NULL DEFAULT 500;
