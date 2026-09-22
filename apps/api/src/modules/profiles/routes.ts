import {
  agencyCardSchema,
  companyDetailSchema,
  type Locale,
  MAP_CLUSTER_SAMPLE,
  mapClusterSchema,
  type Page,
  type ProfileCard,
  type ProfileQuery,
  pageSchema,
  profileCardSchema,
  profileDetailSchema,
  profileQuerySchema,
  slugSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { localeQuerySchema, translationSelect } from '../../i18n.js';
import { isOnline, toMoney, toProfileCard, toProfileDetail } from '../../mappers.js';
import { loadBillingConfig } from '../billing/config.js';
import { shuffle } from '../billing/top.js';
import { publicUrl } from '../photos/storage.js';
import {
  buildProfileWhere,
  decodeCursor,
  decodeRelevanceCursor,
  encodeCursor,
  encodeRelevanceCursor,
  isTopSlot,
  orderByFor,
} from './query.js';

/**
 * Поля карточки листинга. Экспортируется: избранное показывает те же карточки,
 * и второй набор полей рано или поздно разошёлся бы с этим.
 */
export const cardSelect = (locale: Locale) =>
  ({
    id: true,
    slug: true,
    kind: true,
    displayName: true,
    age: true,
    fromPriceCents: true,
    isVerified: true,
    isFeatured: true,
    lastSeenAt: true,
    publishedAt: true,
    city: {
      select: {
        slug: true,
        name: true,
        country: { select: { code: true } },
        translations: translationSelect(locale),
      },
    },
    district: { select: { name: true, translations: translationSelect(locale) } },
    // Отключённую или забаненную компанию не показываем: она снята с витрины целиком.
    company: {
      where: { isActive: true, bannedAt: null },
      select: { slug: true, kind: true, name: true },
    },
    services: {
      // Только действующие: услуга, убранная из справочника, не должна
      // оставаться на уже заполненных анкетах. Удалить её нельзя — на неё
      // ссылаются, — поэтому «убрать» и означает «перестать показывать».
      where: { service: { isActive: true } },
      take: 6,
      select: { service: { select: { key: true, translations: translationSelect(locale) } } },
    },
    photos: {
      where: { isApproved: true, deletedAt: null },
      orderBy: { position: 'asc' },
      take: 1,
      select: {
        id: true,
        storageKey: true,
        width: true,
        height: true,
        blurDataUrl: true,
        position: true,
      },
    },
  }) as const;

/**
 * Лента «по умолчанию»: каждая `RELEVANCE_TOP_PERIOD`-я позиция — ТОП,
 * остальные — органика по свежести (query.ts). Источники читаются двумя
 * отдельными запросами и сплетаются по позиции: если у назначенного
 * позиции источника кончились строки (в городе может быть один ТОП или ни
 * одного), слот забирает другой источник — реестр не должен останавливаться
 * раньше времени только из-за пустого «зарезервированного» места.
 */
async function relevancePage(
  prisma: PrismaClient,
  where: Record<string, unknown>,
  query: ProfileQuery & { locale: Locale },
): Promise<Page<ProfileCard>> {
  const cursorState = decodeRelevanceCursor(query.cursor);
  const select = cardSelect(query.locale);
  const subOrder = orderByFor('newest');

  let featuredNeeded = 0;
  for (let i = 0; i < query.limit; i += 1) {
    if (isTopSlot(cursorState.pos + i)) featuredNeeded += 1;
  }
  const organicNeeded = query.limit - featuredNeeded;
  // Небольшой запас с каждой стороны: дешевле взять на несколько строк
  // больше, чем высчитывать точно, чей «лишний» слот попадёт за границу
  // страницы — именно этот запас и даёт знать, есть ли ещё страница дальше.
  const buffer = 3;

  const [featuredRows, organicRows] = await Promise.all([
    prisma.profile.findMany({
      where: { ...where, isFeatured: true },
      orderBy: subOrder,
      take: featuredNeeded + buffer,
      ...(cursorState.featuredId ? { cursor: { id: cursorState.featuredId }, skip: 1 } : {}),
      select,
    }),
    prisma.profile.findMany({
      where: { ...where, isFeatured: false },
      orderBy: subOrder,
      take: organicNeeded + buffer,
      ...(cursorState.organicId ? { cursor: { id: cursorState.organicId }, skip: 1 } : {}),
      select,
    }),
  ]);

  const items: typeof featuredRows = [];
  let fi = 0;
  let oi = 0;
  let pos = cursorState.pos;
  while (items.length < query.limit) {
    const wantFeatured = isTopSlot(pos);
    const primary = wantFeatured ? featuredRows : organicRows;
    const secondary = wantFeatured ? organicRows : featuredRows;
    if ((wantFeatured ? fi : oi) < primary.length) {
      items.push(primary[wantFeatured ? fi : oi] as (typeof primary)[number]);
      if (wantFeatured) fi += 1;
      else oi += 1;
    } else if ((wantFeatured ? oi : fi) < secondary.length) {
      items.push(secondary[wantFeatured ? oi : fi] as (typeof secondary)[number]);
      if (wantFeatured) oi += 1;
      else fi += 1;
    } else {
      break; // оба источника исчерпаны — дальше листать нечего.
    }
    pos += 1;
  }

  const hasMore = fi < featuredRows.length || oi < organicRows.length;
  const lastFeaturedId = fi > 0 ? (featuredRows[fi - 1]?.id ?? null) : cursorState.featuredId;
  const lastOrganicId = oi > 0 ? (organicRows[oi - 1]?.id ?? null) : cursorState.organicId;

  return {
    items: items.map(toProfileCard),
    nextCursor: hasMore
      ? encodeRelevanceCursor({ pos, featuredId: lastFeaturedId, organicId: lastOrganicId })
      : null,
    total: null,
  };
}

export const profileRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/profiles',
    {
      schema: {
        tags: ['profiles'],
        querystring: profileQuerySchema.and(localeQuerySchema),
        response: { 200: pageSchema(profileCardSchema) },
      },
    },
    async (request) => {
      const query = request.query;
      const where = buildProfileWhere(query);

      // Страница и курсор взаимоисключающи: страница даёт постоянный адрес
      // для обхода ботом, курсор — устойчивую подгрузку для человека.
      const offset = query.page ? (query.page - 1) * query.limit : undefined;

      /**
       * «Релевантность» на первой странице (без номера или `page=1` — так
       * каталог грузится и на сервере при первом заходе, и через «показать
       * ещё» дальше) и без среза «только ТОП» — единственный режим, где ТОП
       * не идёт монолитным блоком наверх: каждая `RELEVANCE_TOP_PERIOD`-я
       * позиция ленты отдаётся ему, а остальные — органике по свежести (см.
       * query.ts). Прыжок сразу на вторую страницу и дальше (`page=2+`,
       * обход ботом) этой перетасовки не получает — там нужен предсказуемый
       * прыжок по номеру, а не история курсора, которую при таком прыжке
       * взять неоткуда.
       */
      if (
        query.sort === 'relevance' &&
        (offset === undefined || offset === 0) &&
        !query.featuredOnly
      ) {
        return relevancePage(fastify.prisma, where, query);
      }

      const cursor = decodeCursor(query.cursor);

      // Берём на одну запись больше запрошенного, чтобы узнать, есть ли следующая страница.
      const rows = await fastify.prisma.profile.findMany({
        where,
        orderBy: orderByFor(query.sort),
        take: query.limit + 1,
        ...(offset !== undefined
          ? { skip: offset }
          : cursor
            ? { cursor: { id: cursor }, skip: 1 }
            : {}),
        select: cardSelect(query.locale),
      });

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return {
        items: page.map(toProfileCard),
        // Проверка `last` не лишняя формальность: `hasMore` гарантирует
        // непустую страницу только вместе с `limit >= 1`, а это условие
        // живёт в схеме запроса, а не здесь.
        nextCursor: hasMore && last ? encodeCursor(last.id) : null,
        total: null,
      };
    },
  );

  fastify.get(
    '/profiles/count',
    {
      schema: {
        tags: ['profiles'],
        querystring: profileQuerySchema,
        response: { 200: z.object({ total: z.number().int().nonnegative() }) },
      },
    },
    async (request) => {
      const total = await fastify.prisma.profile.count({ where: buildProfileWhere(request.query) });
      return { total };
    },
  );

  /**
   * Агентства на главной, между анкетами и массажными салонами (N-44).
   *
   * У компании нет своего поля города — оно есть только у её анкет, поэтому
   * срез «город»/«страна» ищет агентство по опубликованным анкетам, а не по
   * собственному адресу: то же самое, что уже делает `/profiles` для анкет.
   *
   * Порядок (payments.md §3.5, D-14): сначала оплаченные места ТОПа агентств
   * (`isFeatured`), тасуются между собой — честная ротация, как у ТОПа анкет.
   * Остаток `limit` добирают неоплаченные, по убыванию числа анкет в этом же
   * срезе. Секция не пустеет из-за нехватки оплаченных мест — только если
   * во всём срезе нет вообще ни одного подходящего агентства.
   */
  fastify.get(
    '/companies',
    {
      schema: {
        tags: ['profiles'],
        querystring: z.object({
          city: z.string().optional(),
          country: z.string().length(2).optional(),
          limit: z.coerce.number().int().min(1).max(24).default(10),
        }),
        response: { 200: z.array(agencyCardSchema) },
      },
    },
    async (request) => {
      const { city, country, limit } = request.query;
      // Один и тот же срез — и чтобы отобрать агентство (у него есть хоть
      // одна подходящая анкета), и чтобы посчитать, сколько их у него именно
      // здесь: агентство «всей страны» может вести анкеты в разных городах,
      // и число на карточке должно быть про этот срез, а не про агентство
      // целиком.
      const asPublished = city
        ? { status: 'published' as const, city: { slug: city } }
        : country
          ? { status: 'published' as const, country: { code: country.toUpperCase() } }
          : { status: 'published' as const };

      // У компании нет своего города/страны — локация есть только через
      // анкеты. На срезе по конкретному городу агентство без подходящей
      // анкеты определить некуда, поэтому там фильтр остаётся строгим. На
      // срезе «вся страна» (city не выбран — ближайший к глобальной главной
      // режим, N-42) такого ограничения нет: сюда попадает и агентство без
      // единой анкеты (например, ТОП выдан администратором вперёд публикации,
      // см. `grantAgencyTop`) — иначе выданный ТОП был бы нигде не виден.
      const requireProfile = city ? { profiles: { some: asPublished } } : {};

      const featuredRows = await fastify.prisma.company.findMany({
        where: {
          kind: 'agency',
          isActive: true,
          bannedAt: null,
          isFeatured: true,
          ...requireProfile,
        },
        select: {
          slug: true,
          name: true,
          logoStorageKey: true,
          _count: { select: { profiles: { where: asPublished } } },
        },
      });
      const featured = shuffle(featuredRows).slice(0, limit);

      const remaining = limit - featured.length;
      const organicRows =
        remaining > 0
          ? await fastify.prisma.company.findMany({
              where: {
                kind: 'agency',
                isActive: true,
                bannedAt: null,
                isFeatured: false,
                ...requireProfile,
              },
              // Потолок перед сортировкой в приложении: число опубликованных
              // анкет в срезе не выражается прямым `orderBy` на фильтрованном
              // count — Prisma такого не умеет, а агентств немного (D-14).
              take: 200,
              select: {
                slug: true,
                name: true,
                logoStorageKey: true,
                _count: { select: { profiles: { where: asPublished } } },
              },
            })
          : [];
      const organic = organicRows
        .sort((a, b) => b._count.profiles - a._count.profiles || a.slug.localeCompare(b.slug))
        .slice(0, remaining);

      const present = (row: (typeof featuredRows)[number], isFeatured: boolean) => ({
        slug: row.slug,
        name: row.name,
        profileCount: row._count.profiles,
        logoUrl: row.logoStorageKey ? publicUrl(row.logoStorageKey) : null,
        // Известно уже по тому, из какой выборки строка — заново читать
        // поле из базы незачем.
        isFeatured,
      });

      return [
        ...featured.map((row) => present(row, true)),
        ...organic.map((row) => present(row, false)),
      ];
    },
  );

  /**
   * Страница компании: салон или агентство с их анкетами (N-31).
   *
   * Отключённая компания отдаёт 404, а не пустую страницу: снятая с витрины
   * компания не должна оставлять по себе адрес, который выглядит рабочим.
   */
  fastify.get(
    '/companies/:slug',
    {
      schema: {
        tags: ['profiles'],
        params: z.object({ slug: slugSchema }),
        querystring: localeQuerySchema,
        response: {
          200: companyDetailSchema.extend({ profiles: z.array(profileCardSchema) }),
        },
      },
    },
    async (request) => {
      const { locale } = request.query;
      const row = await fastify.prisma.company.findFirst({
        where: { slug: request.params.slug, isActive: true, bannedAt: null },
        select: {
          id: true,
          slug: true,
          kind: true,
          name: true,
          description: true,
          website: true,
          logoStorageKey: true,
          languages: true,
          payments: true,
          isFeatured: true,
          // Только типы — как у анкеты: значения отдаёт лишь раскрытие
          // отдельным маршрутом (payments.md никак не связан, см. N-31/N-08).
          contacts: {
            orderBy: { position: 'asc' },
            select: { type: true },
          },
          profiles: {
            where: { status: 'published' },
            orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
            select: cardSelect(locale),
          },
        },
      });
      if (!row) throw fastify.httpErrors.notFound('Компания не найдена');

      // «Последний онлайн» агентства — по самой свежей из его анкет: своего
      // presence у компании нет, а анкеты уже трогаются им же (см. presence.ts).
      const lastSeenAt = row.profiles.reduce<Date | null>((max, profile) => {
        if (!profile.lastSeenAt) return max;
        return !max || profile.lastSeenAt > max ? profile.lastSeenAt : max;
      }, null);

      return {
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        name: row.name,
        description: row.description,
        website: row.website,
        logoUrl: row.logoStorageKey ? publicUrl(row.logoStorageKey) : null,
        languages: row.languages,
        payments: row.payments,
        contactTypes: [...new Set(row.contacts.map((c) => c.type))],
        isOnline: isOnline(lastSeenAt),
        lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
        profileCount: row.profiles.length,
        isFeatured: row.isFeatured,
        profiles: row.profiles.map(toProfileCard),
      };
    },
  );

  fastify.get(
    '/profiles/:slug',
    {
      schema: {
        tags: ['profiles'],
        params: z.object({ slug: slugSchema }),
        querystring: localeQuerySchema,
        response: { 200: profileDetailSchema },
      },
    },
    async (request) => {
      const row = await fastify.prisma.profile.findFirst({
        where: { slug: request.params.slug, status: 'published' },
        select: {
          ...cardSelect(request.query.locale),
          address: true,
          directions: true,
          minSessionMinutes: true,
          bookingPolicy: true,
          website: true,
          payments: true,
          amenities: true,
          hours: {
            orderBy: { weekday: 'asc' },
            select: { weekday: true, opensAt: true, closesAt: true },
          },
          photos: {
            where: { isApproved: true, deletedAt: null },
            orderBy: { position: 'asc' },
            select: {
              id: true,
              storageKey: true,
              width: true,
              height: true,
              blurDataUrl: true,
              position: true,
            },
          },
          status: true,
          description: true,
          heightCm: true,
          weightKg: true,
          languages: true,
          hairColor: true,
          eyeColor: true,
          breastSize: true,
          breastType: true,
          bodyType: true,
          pubicHair: true,
          hasPiercing: true,
          hasTattoos: true,
          appearanceType: true,
          smoker: true,
          approxLat: true,
          approxLng: true,
          updatedAt: true,
          prices: {
            orderBy: { durationMinutes: 'asc' },
            select: { durationMinutes: true, incallCents: true, outcallCents: true },
          },
          // Порядок каталога задаётся position: без него группы на странице
          // анкеты выстроятся произвольно и разойдутся с формой редактирования.
          services: {
            where: { service: { isActive: true } },
            orderBy: { service: { position: 'asc' } },
            select: {
              isExtra: true,
              service: {
                select: {
                  key: true,
                  group: true,
                  translations: translationSelect(request.query.locale),
                },
              },
            },
          },
          verification: { select: { status: true, reviewedAt: true } },
          // Только тип. Значение сюда не попадает ни при каких условиях —
          // иначе гейт раскрытия становится декоративным.
          contacts: { orderBy: { position: 'asc' }, select: { type: true } },
        },
      });

      if (!row) throw fastify.httpErrors.notFound('Анкета не найдена');
      // Названия групп одним запросом: связи между Service и переводом
      // группы нет — группа хранится строкой, а не сущностью.
      const groupNames = new Map(
        (
          await fastify.prisma.serviceGroupTranslation.findMany({
            where: { locale: request.query.locale },
            select: { groupKey: true, name: true },
          })
        ).map((g) => [g.groupKey, g.name]),
      );

      return toProfileDetail(row, groupNames);
    },
  );

  /**
   * Анкеты на карте. Отдельный маршрут, а не поле в карточке каталога:
   * карте нужны координаты и минимум подписи, но сразу по всем анкетам,
   * а каталогу — полные карточки, но постранично.
   *
   * Группировка на сервере: координаты огрублены до сетки, и число точек
   * ограничено числом ячеек, а не числом анкет. Ответ от этого не растёт
   * с каталогом.
   */
  fastify.get(
    '/profiles/map',
    {
      schema: {
        tags: ['profiles'],
        querystring: profileQuerySchema,
        response: { 200: z.array(mapClusterSchema) },
      },
    },
    async (request) => {
      const rows = await fastify.prisma.profile.findMany({
        where: {
          ...buildProfileWhere(request.query),
          // Без координат точку не поставить.
          approxLat: { not: null },
          approxLng: { not: null },
        },
        orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
        // Потолок на случай, если каталог вырастет: карта не должна тянуть
        // всю базу в один ответ.
        take: 2000,
        select: {
          id: true,
          slug: true,
          displayName: true,
          age: true,
          approxLat: true,
          approxLng: true,
          isVerified: true,
          fromPriceCents: true,
          photos: {
            where: { isApproved: true, deletedAt: null },
            orderBy: { position: 'asc' },
            take: 1,
            select: { storageKey: true },
          },
        },
      });

      type Cluster = z.infer<typeof mapClusterSchema>;
      const byCell = new Map<string, Cluster>();
      for (const row of rows) {
        const lat = row.approxLat as number;
        const lng = row.approxLng as number;
        const key = `${lat}:${lng}`;
        let cell = byCell.get(key);
        if (!cell) {
          cell = { lat, lng, total: 0, profiles: [] };
          byCell.set(key, cell);
        }
        cell.total += 1;
        if (cell.profiles.length < MAP_CLUSTER_SAMPLE) {
          const key0 = row.photos[0]?.storageKey;
          cell.profiles.push({
            id: row.id,
            slug: row.slug,
            displayName: row.displayName,
            age: row.age,
            photoUrl: key0 ? publicUrl(`${key0}/card.webp`) : null,
            fromPrice: toMoney(row.fromPriceCents),
            isVerified: row.isVerified,
          });
        }
      }

      return [...byCell.values()];
    },
  );

  /**
   * ТОП на главной: случайная выборка из анкет с оплаченным местом (§3.4).
   * Сколько показывать — из настроек монетизации. Случайность на сервере:
   * страница кэшируется, и порядок меняется с каждой пересборкой, так что
   * за день каждую из анкет ТОПа увидят одинаково часто.
   */
  fastify.get(
    '/profiles/top',
    {
      schema: {
        tags: ['profiles'],
        querystring: z
          .object({ city: z.string().optional(), country: z.string().length(2).optional() })
          .and(localeQuerySchema),
        response: { 200: pageSchema(profileCardSchema) },
      },
    },
    async (request) => {
      const config = await loadBillingConfig(fastify.prisma);
      const rows = await fastify.prisma.profile.findMany({
        where: {
          status: 'published',
          isFeatured: true,
          ...(request.query.city
            ? { city: { slug: request.query.city } }
            : request.query.country
              ? { country: { code: request.query.country.toUpperCase() } }
              : {}),
        },
        // Мест немного (§3.4): берём все и тасуем — так выборка честная,
        // а не «первые N по дате».
        take: Math.max(config.top.slots, config.top.shown),
        select: cardSelect(request.query.locale),
      });
      const picked = shuffle(rows).slice(0, config.top.shown);
      return { items: picked.map(toProfileCard), nextCursor: null, total: rows.length };
    },
  );

  /** Соседние анкеты для блока «Анкеты рядом» на странице профиля. */
  fastify.get(
    '/profiles/:slug/nearby',
    {
      schema: {
        tags: ['profiles'],
        params: z.object({ slug: slugSchema }),
        querystring: z
          .object({ limit: z.coerce.number().int().min(1).max(24).default(8) })
          .and(localeQuerySchema),
        response: { 200: z.array(profileCardSchema) },
      },
    },
    async (request) => {
      const current = await fastify.prisma.profile.findUnique({
        where: { slug: request.params.slug },
        select: { id: true, cityId: true, kind: true },
      });
      if (!current) throw fastify.httpErrors.notFound('Анкета не найдена');

      const rows = await fastify.prisma.profile.findMany({
        where: {
          status: 'published',
          cityId: current.cityId,
          kind: current.kind,
          id: { not: current.id },
        },
        orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
        take: request.query.limit,
        select: cardSelect(request.query.locale),
      });

      return rows.map(toProfileCard);
    },
  );
};
