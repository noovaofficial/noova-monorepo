/**
 * Сброс второго фактора сотруднику — когда потеряны и телефон, и резервные
 * коды, а попросить другого админа некого (в админке себе фактор сбросить
 * нельзя). После сброса сотрудник настраивает фактор заново при входе.
 *
 *   на сервере: docker compose exec api node dist/scripts/reset-mfa.js <email>
 *   локально:   pnpm --filter @noova/api db:reset-mfa <email>
 *
 * Доступ к этому скрипту — это доступ к серверу, то есть уже полный.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { PrismaClient } from '../generated/prisma/client.js';
import { resetMfa } from '../modules/auth/totp.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Использование: reset-mfa <email>');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const normalized = email.trim().toLowerCase();
const user = await prisma.user.findUnique({
  where: { email: normalized },
  select: { id: true, role: true, totpEnabledAt: true },
});

if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
  console.error(`Сотрудник ${normalized} не найден.`);
  await prisma.$disconnect();
  process.exit(1);
}

await resetMfa(prisma, user.id);

// Сессии, прошедшие прежний фактор, гасим: ключи те же, что в plugins/session.ts.
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const ids = await redis.smembers(`user-sessions:${user.id}`);
if (ids.length > 0) {
  await redis.del(...ids.map((id) => `session:${id}`), `user-sessions:${user.id}`);
}
await redis.quit();
await prisma.$disconnect();

console.log(
  user.totpEnabledAt
    ? `Второй фактор ${normalized} сброшен, сессий погашено: ${ids.length}. При входе он настроит новый.`
    : `У ${normalized} второй фактор и не был настроен. Сессий погашено: ${ids.length}.`,
);
