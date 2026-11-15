import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Замок на вход по учётной записи.
 *
 * Лимит запросов на `/auth/login` считает по адресу, а перебор пароля идёт с
 * пула адресов: каждому достаётся своя квота, и одна учётка получает сколько
 * угодно попыток. Здесь счёт ведётся по email — с какого бы адреса ни пришли.
 *
 * Цена решения: чужими неудачными попытками можно на время закрыть вход
 * настоящему владельцу. Поэтому порог высокий, а замок короткий и снимается
 * сам; сброс пароля письмом замок не затрагивает и остаётся запасным входом.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_SECONDS = 15 * 60;

/** В ключе — хэш: адреса почты в Redis открытым текстом не лежат. */
const key = (email: string) =>
  `login-fail:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;

type Counter = Pick<Redis, 'get' | 'incr' | 'expire' | 'del'>;

export async function isLoginLocked(redis: Counter, email: string): Promise<boolean> {
  return Number(await redis.get(key(email))) >= LOGIN_MAX_FAILURES;
}

/**
 * Считает неудачную попытку. Срок ставится на первой и дальше не двигается:
 * иначе редкие попытки держали бы счётчик вечно, и он однажды дошёл бы до
 * порога у человека, который просто иногда ошибается.
 */
export async function recordLoginFailure(redis: Counter, email: string): Promise<void> {
  const count = await redis.incr(key(email));
  if (count === 1) await redis.expire(key(email), LOGIN_LOCK_SECONDS);
}

export async function clearLoginFailures(redis: Counter, email: string): Promise<void> {
  await redis.del(key(email));
}
