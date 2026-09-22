import type { ProfileQuery, ProfileSort } from '@noova/shared';

/** Курсор — просто id последней записи, но в base64url, чтобы клиент не пытался
 *  его конструировать вручную и мы могли поменять формат без ломки контракта. */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

const ONLINE_WINDOW_MS = 10 * 60 * 1000;

// Возвращаемый объект скармливается Prisma как `where`; форму держим совместимой
// с ProfileWhereInput, но не тянем сгенерированный тип, чтобы не связывать
// модуль запросов с артефактами кодогенерации.
export function buildProfileWhere(query: ProfileQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {
    // Публичное API отдаёт только опубликованные анкеты — черновики и забаненные
    // не должны утекать даже при прямом обращении по фильтру.
    status: 'published',
    kind: query.kind,
  };

  // Приоритет: конкретный город точнее нескольких, несколько — точнее
  // всей страны. Все три одновременно не приходят — это ступени одного
  // выбора места, а не независимые фильтры (N-42, N-43).
  //
  // Страну фильтруем через `Profile.country` напрямую, а не `city.country`:
  // это денормализованная колонка ровно для того, чтобы здесь не понадобился
  // JOIN через City — код страны сначала резолвится в id по уникальному
  // индексу, а дальше в дело идёт составной индекс (status, kind, countryId,
  // publishedAt), а не перебор городов страны один за другим.
  if (query.city) where.city = { slug: query.city };
  else if (query.cities?.length) where.city = { slug: { in: query.cities } };
  else if (query.country) where.country = { code: query.country };
  if (query.district) where.district = { slug: query.district };
  // Анкета должна оказывать все выбранные услуги, а не любую из них:
  // фильтр «ужин + выезд» без этого вернул бы и тех, кто делает только выезд.
  if (query.services?.length) {
    where.AND = query.services.map((key) => ({
      services: { some: { service: { key } } },
    }));
  }
  if (query.verifiedOnly) where.isVerified = true;
  if (query.featuredOnly) where.isFeatured = true;
  // Только опубликованные отзывы: анкета с одним снятым по жалобе
  // комментарием не должна попадать в срез «с отзывами».
  if (query.withCommentsOnly) {
    where.comments = { some: { status: 'published' } };
  }
  if (query.onlineOnly) where.lastSeenAt = { gte: new Date(Date.now() - ONLINE_WINDOW_MS) };

  if (query.minPriceCents !== undefined || query.maxPriceCents !== undefined) {
    where.fromPriceCents = {
      ...(query.minPriceCents !== undefined ? { gte: query.minPriceCents } : {}),
      ...(query.maxPriceCents !== undefined ? { lte: query.maxPriceCents } : {}),
    };
  }

  // Внутри одного параметра значения складываются через ИЛИ: «голубые или
  // зелёные глаза» — это выбор из списка, а не пересечение.
  for (const field of [
    'hairColor',
    'eyeColor',
    'breastSize',
    'breastType',
    'bodyType',
    'pubicHair',
    'appearanceType',
  ] as const) {
    const values = query[field];
    if (values?.length) where[field] = { in: values };
  }

  if (query.languages?.length) where.languages = { hasSome: query.languages };

  // Пирсинг и татуировки — независимые признаки, а не список значений.
  if (query.hasPiercing !== undefined) where.hasPiercing = query.hasPiercing;
  if (query.hasTattoos !== undefined) where.hasTattoos = query.hasTattoos;

  for (const [field, min, max] of [
    ['heightCm', query.heightMin, query.heightMax],
    ['weightKg', query.weightMin, query.weightMax],
  ] as const) {
    if (min !== undefined || max !== undefined) {
      where[field] = {
        ...(min !== undefined ? { gte: min } : {}),
        ...(max !== undefined ? { lte: max } : {}),
      };
    }
  }

  if (query.ageMin !== undefined || query.ageMax !== undefined) {
    where.age = {
      ...(query.ageMin !== undefined ? { gte: query.ageMin } : {}),
      ...(query.ageMax !== undefined ? { lte: query.ageMax } : {}),
    };
  }

  return where;
}

/** Во всех вариантах последним идёт `id`, иначе курсорная пагинация
 *  разъезжается на записях с одинаковым значением ключа сортировки.
 *
 *  Используется как есть для `newest`/`price_*`, и как запасной вариант
 *  «релевантности» там, где курсорное перемешивание не годится (страница по
 *  номеру для ботов, срез «только ТОП») — см. `RELEVANCE_TOP_PERIOD` ниже. */
export function orderByFor(sort: ProfileSort): Record<string, 'asc' | 'desc'>[] {
  switch (sort) {
    case 'newest':
      return [{ publishedAt: 'desc' }, { id: 'desc' }];
    case 'price_asc':
      return [{ fromPriceCents: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ fromPriceCents: 'desc' }, { id: 'desc' }];
    default:
      // «Релевантность» = промо наверху, дальше свежие.
      return [{ isFeatured: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }];
  }
}

/**
 * Каждая RELEVANCE_TOP_PERIOD-я позиция ленты «по умолчанию» отдаётся ТОПу,
 * остальные — органике по свежести. Раньше `isFeatured` было первым ключом
 * сортировки, и все ТОП-анкеты вставали единым блоком в начало — купивший
 * или получивший ТОП занимал всю первую страницу каталога. Теперь ТОП
 * рассыпан по ленте, а не выключен: место просто не монопольное.
 */
export const RELEVANCE_TOP_PERIOD = 5;

/** 0-индексная позиция в общей ленте зарезервирована под ТОП. */
export function isTopSlot(position: number): boolean {
  return position % RELEVANCE_TOP_PERIOD === RELEVANCE_TOP_PERIOD - 1;
}

/** Состояние перемешивания курсора «релевантности»: сколько позиций уже
 *  отдано и на чём остановился каждый из двух источников (ТОП/органика). */
export type RelevanceCursor = {
  pos: number;
  featuredId: string | null;
  organicId: string | null;
};

export function encodeRelevanceCursor(state: RelevanceCursor): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

const emptyRelevanceCursor: RelevanceCursor = { pos: 0, featuredId: null, organicId: null };

export function decodeRelevanceCursor(cursor: string | undefined): RelevanceCursor {
  if (!cursor) return emptyRelevanceCursor;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'pos' in decoded &&
      typeof decoded.pos === 'number' &&
      Number.isInteger(decoded.pos) &&
      decoded.pos >= 0 &&
      'featuredId' in decoded &&
      (decoded.featuredId === null || typeof decoded.featuredId === 'string') &&
      'organicId' in decoded &&
      (decoded.organicId === null || typeof decoded.organicId === 'string')
    ) {
      return decoded as RelevanceCursor;
    }
    return emptyRelevanceCursor;
  } catch {
    return emptyRelevanceCursor;
  }
}
