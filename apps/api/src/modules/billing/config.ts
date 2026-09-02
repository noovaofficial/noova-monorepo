import {
  type BillingConfigInput,
  DEFAULT_BILLING_CONFIG,
  PLAN_KINDS,
  PLAN_TERMS,
} from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** Настройки — одна строка; идентификатор фиксирован. */
const SETTINGS_ID = 'default';

/**
 * Заполняет пустые таблицы значениями из payments.md.
 *
 * Не сид и не миграция: сид на проде пришлось бы не забыть запустить, а
 * миграция вписала бы конфигурацию в код, откуда её потом нельзя править.
 * Значения кладутся один раз — при первом чтении — и дальше источник только
 * база: правки админа этот код не перетирает.
 */
export async function seedBillingDefaults(prisma: PrismaClient): Promise<void> {
  const defaults = DEFAULT_BILLING_CONFIG;
  await prisma.$transaction([
    prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        gcPerEur: defaults.gcPerEur,
        agencyProfileLimit: defaults.agencyProfileLimit,
      },
      update: {},
    }),
    prisma.priceBookEntry.createMany({
      data: PLAN_KINDS.flatMap((kind) =>
        PLAN_TERMS.map((term) => ({ kind, term, gc: defaults.prices[kind][term] })),
      ),
      skipDuplicates: true,
    }),
    prisma.topupTier.createMany({ data: defaults.topupTiers, skipDuplicates: true }),
  ]);
}

export async function loadBillingConfig(prisma: PrismaClient): Promise<BillingConfigInput> {
  const settings = await prisma.billingSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!settings) {
    await seedBillingDefaults(prisma);
    return DEFAULT_BILLING_CONFIG;
  }

  const [entries, tiers] = await Promise.all([
    prisma.priceBookEntry.findMany(),
    prisma.topupTier.findMany({ orderBy: { eur: 'asc' } }),
  ]);

  // Сетка собирается поверх значений по умолчанию: сохранение пишет все
  // ячейки разом, так что пустая может появиться только от правки руками —
  // и лучше показать цену из документа, чем уронить витрину.
  const prices = structuredClone(DEFAULT_BILLING_CONFIG.prices);
  for (const entry of entries) prices[entry.kind][entry.term] = entry.gc;

  return {
    gcPerEur: settings.gcPerEur,
    agencyProfileLimit: settings.agencyProfileLimit,
    prices,
    topupTiers:
      tiers.length > 0
        ? tiers.map((tier) => ({ eur: tier.eur, bonusPercent: tier.bonusPercent }))
        : DEFAULT_BILLING_CONFIG.topupTiers,
  };
}

/**
 * Перезаписывает конфигурацию целиком, одной транзакцией: половина новой
 * лестницы рядом с половиной старой — это лестница, которой никто не
 * утверждал.
 */
export async function saveBillingConfig(
  prisma: PrismaClient,
  input: BillingConfigInput,
): Promise<BillingConfigInput> {
  await prisma.$transaction([
    prisma.billingSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        gcPerEur: input.gcPerEur,
        agencyProfileLimit: input.agencyProfileLimit,
      },
      update: { gcPerEur: input.gcPerEur, agencyProfileLimit: input.agencyProfileLimit },
    }),
    ...PLAN_KINDS.flatMap((kind) =>
      PLAN_TERMS.map((term) =>
        prisma.priceBookEntry.upsert({
          where: { kind_term: { kind, term } },
          create: { kind, term, gc: input.prices[kind][term] },
          update: { gc: input.prices[kind][term] },
        }),
      ),
    ),
    prisma.topupTier.deleteMany(),
    prisma.topupTier.createMany({ data: input.topupTiers }),
  ]);

  return loadBillingConfig(prisma);
}
