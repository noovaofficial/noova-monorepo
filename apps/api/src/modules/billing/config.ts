import {
  DEFAULT_BILLING_CONFIG,
  DEFAULT_MODERATOR_ADJUST_LIMIT_GC,
  type GlobalBillingConfig,
} from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** Настройки — одна строка; идентификатор фиксирован. */
const SETTINGS_ID = 'default';

const DEFAULT_GLOBAL_CONFIG: GlobalBillingConfig = {
  gcPerEur: DEFAULT_BILLING_CONFIG.gcPerEur,
  topupTiers: DEFAULT_BILLING_CONFIG.topupTiers,
  agencyProfileLimit: DEFAULT_BILLING_CONFIG.agencyProfileLimit,
  topShown: DEFAULT_BILLING_CONFIG.top.shown,
  moderatorAdjustLimitGc: DEFAULT_MODERATOR_ADJUST_LIMIT_GC,
};

/**
 * Заполняет пустые таблицы значениями из payments.md.
 *
 * Не сид и не миграция: сид на проде пришлось бы не забыть запустить, а
 * миграция вписала бы конфигурацию в код, откуда её потом нельзя править.
 * Значения кладутся один раз — при первом чтении — и дальше источник только
 * база: правки админа этот код не перетирает.
 *
 * Здесь только общее: курс, лестница пополнений, лимиты. Цены размещения,
 * ТОП и тарифы агентств живут в странах (см. `scoped.ts`).
 */
export async function seedBillingDefaults(prisma: PrismaClient): Promise<void> {
  const defaults = DEFAULT_GLOBAL_CONFIG;
  await prisma.$transaction([
    prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        gcPerEur: defaults.gcPerEur,
        agencyProfileLimit: defaults.agencyProfileLimit,
        topShown: defaults.topShown,
        moderatorAdjustLimitGc: defaults.moderatorAdjustLimitGc,
      },
      update: {},
    }),
    prisma.topupTier.createMany({ data: defaults.topupTiers, skipDuplicates: true }),
  ]);
}

export async function loadBillingConfig(prisma: PrismaClient): Promise<GlobalBillingConfig> {
  const settings = await prisma.billingSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!settings) {
    await seedBillingDefaults(prisma);
    return DEFAULT_GLOBAL_CONFIG;
  }

  const tiers = await prisma.topupTier.findMany({ orderBy: { eur: 'asc' } });

  return {
    gcPerEur: settings.gcPerEur,
    agencyProfileLimit: settings.agencyProfileLimit,
    moderatorAdjustLimitGc: settings.moderatorAdjustLimitGc,
    topShown: settings.topShown,
    topupTiers:
      tiers.length > 0
        ? tiers.map((tier) => ({ eur: tier.eur, bonusPercent: tier.bonusPercent }))
        : DEFAULT_GLOBAL_CONFIG.topupTiers,
  };
}

/**
 * Перезаписывает общие настройки целиком, одной транзакцией: половина новой
 * лестницы рядом с половиной старой — это лестница, которой никто не
 * утверждал.
 */
export async function saveBillingConfig(
  prisma: PrismaClient,
  input: GlobalBillingConfig,
): Promise<GlobalBillingConfig> {
  const data = {
    gcPerEur: input.gcPerEur,
    agencyProfileLimit: input.agencyProfileLimit,
    topShown: input.topShown,
    moderatorAdjustLimitGc: input.moderatorAdjustLimitGc,
  };
  await prisma.$transaction([
    prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    }),
    prisma.topupTier.deleteMany(),
    prisma.topupTier.createMany({ data: input.topupTiers }),
  ]);

  return loadBillingConfig(prisma);
}
