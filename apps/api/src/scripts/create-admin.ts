/**
 * Первый администратор. Его некому создать через интерфейс — это проблема
 * курицы и яйца, и решается она разово при развёртывании.
 *
 *   локально: pnpm --filter @noova/api db:create-admin <email> <пароль>
 *   на сервере: docker compose exec api node dist/scripts/create-admin.js <email> <пароль>
 *
 * Дальше администратор заводит модераторов сам, в разделе /admin.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { hashPassword } from '../modules/auth/passwords.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL не задан.');
  process.exit(1);
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Использование: db:create-admin <email> <пароль>');
  process.exit(1);
}
if (password.length < 10) {
  console.error('Пароль должен быть не короче 10 символов.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const normalized = email.trim().toLowerCase();
const existing = await prisma.user.findUnique({
  where: { email: normalized },
  select: { id: true, role: true },
});

if (existing) {
  // Повышать существующую учётку не даём: у рекламодателя есть анкеты, и
  // смена роли превратила бы его в модератора собственных материалов.
  console.error(`Пользователь ${normalized} уже существует (роль ${existing.role}).`);
  process.exit(1);
}

const admin = await prisma.user.create({
  data: {
    email: normalized,
    passwordHash: await hashPassword(password),
    role: 'admin',
    emailVerifiedAt: new Date(),
    isAdult: true,
  },
  select: { id: true, email: true },
});

console.log(`Администратор создан: ${admin.email}`);
await prisma.$disconnect();
