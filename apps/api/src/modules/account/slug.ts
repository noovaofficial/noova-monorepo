import type { PrismaClient } from '../../generated/prisma/client.js';

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/**
 * Slug строится латиницей: он попадает в URL, а кириллица там превращается
 * в процентные последовательности, нечитаемые ни для человека, ни для выдачи.
 */
function slugify(value: string): string {
  const lower = value.toLowerCase();
  let out = '';
  for (const char of lower) {
    out += TRANSLIT[char] ?? char;
  }
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Уникальный slug вида `name-city` с числовым суффиксом при коллизии.
 * Проверка идёт в цикле, а не одной вставкой с обработкой ошибки: так понятнее,
 * и гонка здесь неопасна — уникальный индекс всё равно последнее слово.
 */
export async function buildUniqueSlug(
  prisma: PrismaClient,
  displayName: string,
  citySlug: string,
): Promise<string> {
  const base = `${slugify(displayName) || 'profile'}-${citySlug}`;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.profile.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}
