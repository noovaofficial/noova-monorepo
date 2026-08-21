/**
 * Учётные записи для локальной проверки.
 *
 * Только для разработки: пароли лежат открытым текстом в этом файле и в
 * documentation/test-credentials.md. Запускать где-либо, кроме локальной
 * машины, нельзя — на сервере отказывается работать сам скрипт.
 *
 *   pnpm --filter @noova/api db:seed:dev-users
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/modules/auth/passwords.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Отказ: тестовые учётки нельзя заводить в проде.');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type DevUser = {
  email: string;
  password: string;
  role: 'client' | 'advertiser' | 'moderator' | 'admin';
  advertiserKind?: 'individual' | 'salon';
  nickname?: string;
};

const USERS: DevUser[] = [
  { email: 'admin@noova.local', password: 'admin-password-1', role: 'admin' },
  { email: 'mod@noova.local', password: 'moderator-pass-1', role: 'moderator' },
  {
    email: 'individual@noova.local',
    password: 'individual-pass-1',
    role: 'advertiser',
    advertiserKind: 'individual',
  },
  {
    email: 'salon@noova.local',
    password: 'salon-pass-secret',
    role: 'advertiser',
    advertiserKind: 'salon',
  },
  {
    email: 'client@noova.local',
    password: 'client-pass-secret',
    role: 'client',
    nickname: 'tester',
  },
];

for (const user of USERS) {
  const passwordHash = await hashPassword(user.password);

  await prisma.user.upsert({
    where: { email: user.email },
    // Пароль и роль перезаписываем: скрипт должен возвращать учётки в
    // известное состояние, даже если их успели поменять руками.
    update: {
      passwordHash,
      role: user.role,
      advertiserKind: user.advertiserKind ?? null,
      emailVerifiedAt: new Date(),
      bannedAt: null,
    },
    create: {
      email: user.email,
      passwordHash,
      role: user.role,
      advertiserKind: user.advertiserKind ?? null,
      emailVerifiedAt: new Date(),
      isAdult: true,
      ...(user.nickname ? { clientProfile: { create: { nickname: user.nickname } } } : {}),
    },
  });

  console.log(`  ${user.email.padEnd(26)} ${user.role}`);
}

console.log(
  `\nГотово: ${USERS.length} учётных записей. Пароли — в documentation/test-credentials.md`,
);
await prisma.$disconnect();
