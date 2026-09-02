/**
 * Стартовый год для текущих рекламодателей (payments.md, D-05).
 *
 * Запускается один раз при включении пейвола, до `PAYWALL_ENABLED=true`:
 * каждому рекламодателю без размещения начисляется цена годового тарифа его
 * типа и тут же списывается активацией на 12 месяцев. В журнале это две
 * видимые записи, а не «бесплатно»: через год человек увидит, за что и когда
 * его размещение закончилось.
 *
 *   локально:  pnpm --filter @noova/api billing:grant-launch
 *   на сервере: docker compose exec api node dist/scripts/grant-launch-listings.js
 *
 * Идемпотентно: у кого размещение уже есть — пропускается. Повторный запуск
 * ничего не начислит дважды.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadBillingConfig } from '../modules/billing/config.js';
import { activateListing } from '../modules/billing/listing.js';
import { applyTransaction } from '../modules/billing/wallet.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Причина в журнале — на языке владельца: он её и читает. */
const NOTE: Record<string, string> = {
  de: 'Startangebot: 12 Monate Platzierung inklusive',
  en: 'Launch offer: 12 months of listing included',
  ru: 'Стартовое предложение: 12 месяцев размещения включены',
};

async function main() {
  const config = await loadBillingConfig(prisma);

  const advertisers = await prisma.user.findMany({
    where: {
      role: 'advertiser',
      advertiserKind: { not: null },
      bannedAt: null,
      deletionRequestedAt: null,
      listings: { none: {} },
    },
    select: { id: true, email: true, locale: true, advertiserKind: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Рекламодателей без размещения: ${advertisers.length}`);

  let granted = 0;
  for (const user of advertisers) {
    if (!user.advertiserKind) continue;
    const priceGc = config.prices[user.advertiserKind].m12;

    try {
      await applyTransaction(prisma, {
        userId: user.id,
        kind: 'ADJUSTMENT',
        gcAmount: priceGc,
        note: NOTE[user.locale] ?? NOTE.de,
      });
      await activateListing(prisma, {
        userId: user.id,
        kind: user.advertiserKind,
        term: 'm12',
        priceGc,
      });
      granted += 1;
      console.log(`✓ ${user.email}: ${user.advertiserKind}, ${priceGc} GC, 12 месяцев`);
    } catch (error) {
      // Ошибка одного не должна останавливать остальных: повторный запуск
      // доберёт пропущенных, а у этого уже есть начисление и нет листинга —
      // это видно в журнале, и разобрать такой случай руками просто.
      console.error(`✗ ${user.email}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`Выдано: ${granted} из ${advertisers.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
