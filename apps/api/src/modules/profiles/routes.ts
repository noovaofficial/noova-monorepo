import {
  companySchema,
  type Locale,
  MAP_CLUSTER_SAMPLE,
  mapClusterSchema,
  pageSchema,
  profileCardSchema,
  profileDetailSchema,
  profileQuerySchema,
  slugSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { localeQuerySchema, translationSelect } from '../../i18n.js';
import { toMoney, toProfileCard, toProfileDetail } from '../../mappers.js';
import { loadBillingConfig } from '../billing/config.js';
import { shuffle } from '../billing/top.js';
import { publicUrl } from '../photos/storage.js';
import { buildProfileWhere, decodeCursor, encodeCursor, orderByFor } from './query.js';

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
    // Отключённую компанию не показываем: она снята с витрины целиком.
    company: {
      where: { isActive: true },
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
      const cursor = decodeCursor(query.cursor);

      // Страница и курсор взаимоисключающи: страница даёт постоянный адрес
      // для обхода ботом, курсор — устойчивую подгрузку для человека.
      const offset = query.page ? (query.page - 1) * query.limit : undefined;

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
          200: companySchema.extend({ profiles: z.array(profileCardSchema) }),
        },
      },
    },
    async (request) => {
      const { locale } = request.query;
      const row = await fastify.prisma.company.findFirst({
        where: { slug: request.params.slug, isActive: true },
        select: {
          id: true,
          slug: true,
          kind: true,
          name: true,
          description: true,
          isActive: true,
          languages: true,
          payments: true,
          contacts: {
            orderBy: { position: 'asc' },
            select: { type: true, value: true },
          },
          profiles: {
            where: { status: 'published' },
            orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
            select: cardSelect(locale),
          },
        },
      });
      if (!row) throw fastify.httpErrors.notFound('Компания не найдена');

      return {
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        name: row.name,
        description: row.description,
        contacts: row.contacts,
        languages: row.languages,
        payments: row.payments,
        isActive: row.isActive,
        profileCount: row.profiles.length,
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
        querystring: z.object({ city: z.string().optional() }).and(localeQuerySchema),
        response: { 200: pageSchema(profileCardSchema) },
      },
    },
    async (request) => {
      const config = await loadBillingConfig(fastify.prisma);
      const rows = await fastify.prisma.profile.findMany({
        where: {
          status: 'published',
          isFeatured: true,
          ...(request.query.city ? { city: { slug: request.query.city } } : {}),
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
