import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Второй фактор сотрудников: одноразовые коды по времени (TOTP, RFC 6238).
 *
 * Своя реализация вместо библиотеки: алгоритм — два десятка строк на
 * встроенном `crypto`, сверяется эталонными векторами из стандарта
 * (totp.test.ts), а лишняя зависимость в цепочке входа ни к чему.
 *
 * Параметры — те, что понимает любое приложение (Google Authenticator,
 * Aegis, 1Password): SHA-1, 6 цифр, шаг 30 секунд.
 */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
/** Сколько соседних шагов принимаем: часы телефона и сервера расходятся. */
const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Некорректный base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Секрет для приложения: 160 бит, как советует RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** Код для шага (HOTP, RFC 4226). */
export function totpCode(secret: string, step: number, digits: number = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Проверка кода. Возвращает шаг, на котором код совпал, или `null`.
 *
 * `lastStep` — шаг последнего принятого кода: тот же или более ранний не
 * принимается. Без этого подсмотренный код оставался бы годным ещё до минуты.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { now?: Date; lastStep?: number | null } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(options.now);
  let matched: number | null = null;
  // Перебираем все шаги окна без раннего выхода — время ответа не должно
  // подсказывать, на каком из них код совпал.
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    if (sameText(totpCode(secret, step), code) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastStep != null && matched <= options.lastStep) return null;
  return matched;
}

/** Ссылка, которую кодирует QR: её читает приложение-аутентификатор. */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Хранение секрета -------------------------------------------------------

/**
 * Секрет лежит в базе зашифрованным (AES-256-GCM). Хэшировать его нельзя —
 * по нему каждый раз считается код, — а открытым текстом он превращал бы
 * дамп базы в связку вторых факторов всех сотрудников.
 *
 * Ключ выводится из `MFA_SECRET_KEY` через HKDF: переменная может быть любой
 * длинной строкой, а шифру нужно ровно 32 байта.
 */
function cipherKey(masterKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, 'noova-mfa', 'totp-secret-v1', 32));
}

export function encryptSecret(secret: string, masterKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(masterKey), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** `null` — запись повреждена или зашифрована другим ключом. */
export function decryptSecret(stored: string, masterKey: string): string | null {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      cipherKey(masterKey),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

// --- Резервные коды ---------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
/** Без похожих знаков (0/O, 1/I/L): код переписывают с бумаги. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Десять символов двумя группами: около 49 бит — перебором не взять. */
export function generateRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < 10; i += 1) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** Приводит ввод к виду, в котором код хэшировался: без пробелов и дефисов. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function looksLikeRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === 10 && !/^\d{6}$/.test(input.trim());
}

/** В базе — только хэш. Соль не нужна: код случайный и длинный. */
export function hashRecoveryCode(input: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(input)).digest('hex');
}

// --- Сброс ------------------------------------------------------------------

type ResetDb = {
  user: { update(args: { where: { id: string }; data: object }): Promise<unknown> };
  mfaRecoveryCode: { deleteMany(args: { where: { userId: string } }): Promise<unknown> };
};

/**
 * Снимает второй фактор: при следующем входе сотрудник настроит его заново.
 * Общая для админки и скрипта `reset-mfa`. Сессии гасит вызывающий — у
 * скрипта и у сервера доступ к ним разный.
 */
export async function resetMfa(db: ResetDb, userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
  });
  await db.mfaRecoveryCode.deleteMany({ where: { userId } });
}
