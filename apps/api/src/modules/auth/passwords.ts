import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id, а не bcrypt: у bcrypt лимит в 72 байта и слабее сопротивление
 * перебору на GPU. Параметры — рекомендация OWASP (19 МБ памяти, 2 итерации).
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password, OPTIONS);
  } catch {
    // Битый хэш в БД не должен пускать внутрь.
    return false;
  }
}

/**
 * Сравнение-пустышка для несуществующего пользователя. Без него время ответа
 * на «нет такого email» заметно меньше, чем на «есть, но пароль неверный»,
 * и по таймингу можно перебирать существующие адреса.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdA$JmVpQvRDLuGe6ByPsHW3ZzXqYqDdBxKmLKUgDZQvXNo';

export async function burnTimeLikeVerify(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password);
}
