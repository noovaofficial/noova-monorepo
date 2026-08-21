import { z } from 'zod';

export const contactTypeSchema = z.enum(['phone', 'whatsapp', 'telegram', 'viber']);
export type ContactType = z.infer<typeof contactTypeSchema>;

/** Порядок в интерфейсе: телефон первым, дальше мессенджеры по популярности. */
export const CONTACT_TYPES: readonly ContactType[] = [
  'phone',
  'whatsapp',
  'telegram',
  'viber',
] as const;

/** Четыре типа, у салона на каждый может быть второй номер. Больше — спам-лист. */
export const MAX_CONTACTS_PER_PROFILE = 8;

/**
 * Страна по умолчанию для номеров, записанных в национальном формате.
 * Рынок один — Германия, и требовать «+49» от владелицы, которая всю жизнь
 * пишет «0170…», значит ловить её на ошибке там, где догадка однозначна.
 */
const DEFAULT_COUNTRY_CODE = '49';

export type NormalizedContact = { ok: true; value: string } | { ok: false; reason: string };

/** Ник в Telegram: сам сервис допускает a-z, 0-9 и подчёркивание, 5–32 знака. */
const TELEGRAM_USERNAME = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

/**
 * Телефон приводится к виду «плюс и цифры» — единственному, из которого
 * одинаково собираются `tel:`, `wa.me` и `viber://`. Хранить то, что набрала
 * владелица, нельзя: «0170 123-45-67» и «+49 170 1234567» это один номер,
 * а в базе оказались бы два, и `@@unique` их не поймает.
 *
 * Ни формат, ни длина внутри номера не проверяются намеренно. Поле в форме
 * гарантирует ведущий «+» и не пускает буквы — этого достаточно. Единственный
 * отказ здесь: цифр нет вовсе, то есть сохранять нечего. Верхнюю границу
 * задаёт схема хранения (64 знака), а не представление о «правильной» длине.
 */
function normalizePhone(raw: string): NormalizedContact {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 0) return { ok: false, reason: 'empty' };

  let normalized: string;
  if (trimmed.startsWith('+')) {
    normalized = digits;
  } else if (digits.startsWith('00')) {
    // Международный префикс в европейской записи — тот же «+».
    normalized = digits.slice(2);
  } else if (digits.startsWith('0')) {
    // Вставленный национальный номер: рынок один, догадка однозначна.
    normalized = DEFAULT_COUNTRY_CODE + digits.slice(1);
  } else {
    // Вставили без «+» и без нуля — считаем, что код страны уже написан:
    // маска в форме всё равно поставит «+» перед этим значением.
    normalized = digits;
  }

  return { ok: true, value: `+${normalized}` };
}

/**
 * Telegram живёт и по нику, и по номеру. Ссылку вида `t.me/nick` приводим
 * к нику: владелицы копируют её из приложения целиком, и отказ на этом
 * месте выглядел бы придиркой.
 */
function normalizeTelegram(raw: string): NormalizedContact {
  const stripped = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(t\.me|telegram\.me|telegram\.dog)\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');

  if (stripped === '') return { ok: false, reason: 'empty' };
  // Номер отличаем от ника по первому знаку: ник в Telegram всегда с буквы.
  if (/^[+0-9]/.test(stripped)) return normalizePhone(stripped);
  if (!TELEGRAM_USERNAME.test(stripped)) return { ok: false, reason: 'telegramUsername' };

  return { ok: true, value: `@${stripped}` };
}

/**
 * Единая точка нормализации. Вызывается на сервере как обязательная —
 * форма может подсказать заранее, но верить ей нельзя.
 */
export function normalizeContact(type: ContactType, raw: string): NormalizedContact {
  return type === 'telegram' ? normalizeTelegram(raw) : normalizePhone(raw);
}

/**
 * Номер это или ник. Telegram принимает и то и другое; остальные каналы
 * умеют строить ссылку только по номеру.
 */
export function isPhoneLike(value: string): boolean {
  return /^\+?[\d\s()-]+$/.test(value.trim());
}

/**
 * Маска поля ввода. Для номерных каналов гарантирует ведущий «+» и не даёт
 * набрать в номере букв; разделители — пробелы, скобки, дефисы — оставляет
 * как есть: как владелице удобно, так пусть и пишет, к одному виду значение
 * приведёт `normalizeContact` при сохранении.
 *
 * Живёт рядом с нормализацией не случайно: маска и проверка обязаны
 * договориться о том, что считается допустимым, иначе форма разрешит
 * набрать то, что сервер потом отвергнет.
 */
export function maskContactValue(type: ContactType, raw: string): string {
  // У Telegram ник — полноценное значение, маску накладывать не на что.
  if (type === 'telegram') return raw.trimStart();

  const cleaned = raw.replace(/[^\d\s()-]/g, '');
  // Ведущий «+» ставим сами и не даём его стереть: без него неясно, чей это
  // код страны, а гадать по одним цифрам нельзя.
  return `+${cleaned.trimStart()}`;
}

/** Куда ведёт строка контакта после раскрытия. */
export function contactHref(type: ContactType, value: string): string {
  switch (type) {
    case 'phone':
      return `tel:${value}`;
    case 'whatsapp':
      // wa.me принимает только цифры, без «+».
      return `https://wa.me/${value.replace(/\D/g, '')}`;
    case 'telegram':
      return value.startsWith('@')
        ? `https://t.me/${value.slice(1)}`
        : `https://t.me/${value.replace(/\D/g, '')}`;
    case 'viber':
      return `viber://chat?number=${encodeURIComponent(value)}`;
  }
}

/** Одна строка контакта: тип и значение. Наружу отдаётся только после раскрытия. */
export const profileContactSchema = z.object({
  type: contactTypeSchema,
  value: z.string().min(1).max(64),
});
export type ProfileContact = z.infer<typeof profileContactSchema>;

/**
 * Ввод владелицы. Значение здесь ещё «сырое»: пределы длины отсекают мусор,
 * а форму проверяет `normalizeContact` на сервере — там же, где ошибка
 * может быть названа конкретным полем.
 */
export const contactInputSchema = z.object({
  type: contactTypeSchema,
  // Нижняя граница — один знак: короткий номер это тоже номер, и решать за
  // владелицу, сколько цифр «правильно», мы не беремся. Верхняя — предел
  // хранения, а не суждение о номере.
  value: z.string().trim().min(1).max(64),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

/** Ответ на явное раскрытие. Отдельная схема, потому что отдельный маршрут. */
export const revealedContactsSchema = z.object({
  contacts: z.array(profileContactSchema),
});
export type RevealedContacts = z.infer<typeof revealedContactsSchema>;
