/**
 * Наполнение справочника услуг. Отдельно от общего сида: справочник живёт
 * дольше демо-данных и накатывается на прод, где сносить анкеты нельзя.
 * Идемпотентно — существующие услуги обновляются, лишние деактивируются.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { SERVICE_CATALOG, SERVICE_GROUPS } from './services.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  for (const [index, service] of SERVICE_CATALOG.entries()) {
    await prisma.service.upsert({
      where: { key: service.key },
      create: {
        key: service.key,
        group: service.group,
        appliesTo: service.appliesTo,
        position: SERVICE_GROUPS.indexOf(service.group as never) * 100 + index,
        isActive: true,
      },
      update: {
        group: service.group,
        appliesTo: service.appliesTo,
        position: SERVICE_GROUPS.indexOf(service.group as never) * 100 + index,
        isActive: true,
      },
    });
  }

  // Услугу, выпавшую из каталога, не удаляем: она может быть выбрана в анкетах,
  // и удаление порвало бы связи. Просто скрываем из выбора.
  const keys = SERVICE_CATALOG.map((s) => s.key);
  const { count } = await prisma.service.updateMany({
    where: { key: { notIn: keys } },
    data: { isActive: false },
  });

  console.log(`Справочник услуг: ${SERVICE_CATALOG.length} активных, ${count} деактивировано`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
