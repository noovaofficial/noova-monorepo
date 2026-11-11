/**
 * География из админки: страны, города, районы (N-32).
 *
 * Доступ — только `admin`. Модератору сюда нельзя: состав стран определяет,
 * в каких юрисдикциях работает площадка, и это решение владельца, а не
 * оператора очереди. По той же причине здесь нет удаления — только
 * отключение: на страну ссылаются города, на города и районы — анкеты.
 */
import {
  cityInputSchema,
  cityMonetizationInputSchema,
  cityMonetizationSchema,
  citySchemaAdmin,
  citySlugCollidesWithCountry,
  countryInputSchema,
  countryMonetizationSchema,
  countrySchema,
  districtInputSchema,
  LOCALES,
  placementKindSchema,
  placementRuleInputSchema,
  placementRuleSchema,
  type Translated,
  toTranslated,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env.js';
import { BILLING_TAG, CITIES_TAG, PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { pushMail } from '../auth/mail-queue.js';
import { startPlacementGrace } from '../billing/placement-grace.js';
import { syncPremiumForPlace } from '../billing/premium.js';
import {
  getCityMonetization,
  getCountryMonetization,
  saveCityMonetization,
  saveCountryMonetization,
} from '../billing/scoped.js';
import { CITY_HAS_PROFILES, canMoveCityToCountry, withCode } from './country-lock.js';

/** Строки переводов в объект по локалям; неполный набор — ошибка данных. */
function fromRows(rows: { locale: string; name: string }[], fallback: string): Translated {
  return (
    toTranslated(rows) ?? (Object.fromEntries(LOCALES.map((l) => [l, fallback])) as Translated)
  );
}

/** Вложенная запись переводов: все локали одной транзакцией. */
const translationRows = (name: Translated) =>
  LOCALES.map((locale) => ({ locale, name: name[locale] }));

const idParams = z.object({ id: z.string().min(1) });

export const locationRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const guard = fastify.requireRole('admin');

  // ---------------------------------------------------------------- страны

  fastify.get(
    '/admin/countries',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], response: { 200: z.array(countrySchema) } },
    },
    async () => {
      const rows = await fastify.prisma.country.findMany({
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          isDefault: true,
          currency: true,
          translations: { select: { locale: true, name: true } },
          _count: { select: { cities: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: fromRows(row.translations, row.name),
        isActive: row.isActive,
        isDefault: row.isDefault,
        currency: row.currency,
        cityCount: row._count.cities,
      }));
    },
  );

  fastify.post(
    '/admin/countries',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], body: countryInputSchema, response: { 201: countrySchema } },
    },
    async (request, reply) => {
      const { code, name, isActive, isDefault, currency } = request.body;

      const exists = await fastify.prisma.country.findUnique({ where: { code } });
      if (exists)
        throw withCode(
          fastify.httpErrors.conflict(`Страна ${code} уже заведена`),
          'country_exists',
        );
      if (isDefault && !isActive) {
        throw withCode(
          fastify.httpErrors.badRequest('Отключённая страна не может быть страной по умолчанию'),
          'default_country_inactive',
        );
      }

      // По умолчанию — ровно одна: снимаем флаг с прежней в той же транзакции,
      // что заводит новую, иначе между двумя запросами их окажется две.
      const created = await fastify.prisma.$transaction(async (tx) => {
        if (isDefault) await tx.country.updateMany({ data: { isDefault: false } });
        return tx.country.create({
          data: {
            code,
            name: name.de,
            isActive,
            isDefault,
            ...(currency ? { currency } : {}),
            translations: { create: translationRows(name) },
          },
          select: {
            id: true,
            code: true,
            isActive: true,
            isDefault: true,
            currency: true,
          },
        });
      });

      return reply.status(201).send({ ...created, name, cityCount: 0 });
    },
  );

  fastify.patch(
    '/admin/countries/:id',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParams,
        body: countryInputSchema.partial({ code: true }),
        response: { 200: countrySchema },
      },
    },
    async (request) => {
      const { name, isActive, isDefault, currency } = request.body;
      if (isDefault && !isActive) {
        throw withCode(
          fastify.httpErrors.badRequest('Отключённая страна не может быть страной по умолчанию'),
          'default_country_inactive',
        );
      }

      // По умолчанию — ровно одна: снимаем флаг с прежней в той же транзакции.
      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (isDefault) {
          await tx.country.updateMany({
            where: { id: { not: request.params.id } },
            data: { isDefault: false },
          });
        }
        return tx.country.update({
          where: { id: request.params.id },
          data: {
            name: name.de,
            isActive,
            isDefault,
            // Валюта и курс меняются, только если пришли: форма без них не
            // должна сбрасывать настройку страны.
            ...(currency ? { currency } : {}),
            // Переводы переписываем целиком: частичный набор невозможен по
            // контракту, а точечное обновление оставило бы строки от прошлых локалей.
            translations: { deleteMany: {}, create: translationRows(name) },
          },
          select: {
            id: true,
            code: true,
            isActive: true,
            isDefault: true,
            currency: true,
            _count: { select: { cities: true } },
          },
        });
      });
      // Отключение страны прячет её города со стороны посетителя (N-32) —
      // без сброса это было бы видно только после истечения ISR (до 5 минут).
      // Смена страны по умолчанию меняет тот же корневой редирект — тег общий.
      fastify.revalidate([CITIES_TAG, PROFILES_TAG]);

      return {
        id: updated.id,
        code: updated.code,
        name,
        isActive: updated.isActive,
        isDefault: updated.isDefault,
        currency: updated.currency,
        cityCount: updated._count.cities,
      };
    },
  );

  // ---------------------------------------------------------------- города

  const cityShape = {
    id: true,
    slug: true,
    name: true,
    countryId: true,
    lat: true,
    lng: true,
    isActive: true,
    country: { select: { code: true } },
    translations: { select: { locale: true, name: true } },
    _count: { select: { profiles: true } },
    districts: {
      orderBy: { slug: 'asc' as const },
      select: {
        id: true,
        slug: true,
        name: true,
        lat: true,
        lng: true,
        isActive: true,
        translations: { select: { locale: true, name: true } },
        _count: { select: { profiles: true } },
      },
    },
  };

  type CityRow = {
    id: string;
    slug: string;
    name: string;
    countryId: string;
    lat: number | null;
    lng: number | null;
    isActive: boolean;
    country: { code: string };
    translations: { locale: string; name: string }[];
    _count: { profiles: number };
    districts: {
      id: string;
      slug: string;
      name: string;
      lat: number | null;
      lng: number | null;
      isActive: boolean;
      translations: { locale: string; name: string }[];
      _count: { profiles: number };
    }[];
  };

  const present = (row: CityRow) => ({
    id: row.id,
    slug: row.slug,
    name: fromRows(row.translations, row.name),
    countryId: row.countryId,
    countryCode: row.country.code,
    lat: row.lat,
    lng: row.lng,
    isActive: row.isActive,
    profileCount: row._count.profiles,
    districts: row.districts.map((d) => ({
      id: d.id,
      slug: d.slug,
      name: fromRows(d.translations, d.name),
      // Координаты района обязательны по контракту: из них собирается
      // приблизительное местоположение анкеты. Ноль здесь честнее null —
      // запись без координат в базу попасть не может.
      lat: d.lat ?? 0,
      lng: d.lng ?? 0,
      isActive: d.isActive,
      profileCount: d._count.profiles,
    })),
  });

  fastify.get(
    '/admin/cities',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        querystring: z.object({ countryId: z.string().min(1).optional() }),
        response: { 200: z.array(citySchemaAdmin) },
      },
    },
    async (request) => {
      const rows = await fastify.prisma.city.findMany({
        where: request.query.countryId ? { countryId: request.query.countryId } : {},
        orderBy: { slug: 'asc' },
        select: cityShape,
      });
      return rows.map(present);
    },
  );

  fastify.post(
    '/admin/cities',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], body: cityInputSchema, response: { 201: citySchemaAdmin } },
    },
    async (request, reply) => {
      const { slug, name, countryId, lat, lng, isActive, districts } = request.body;

      const exists = await fastify.prisma.city.findUnique({ where: { slug } });
      if (exists)
        throw withCode(fastify.httpErrors.conflict(`Город ${slug} уже заведён`), 'city_exists');

      // Слуг города делит второй сегмент адреса с кодом страны (N-42):
      // `/de` не может одновременно значить и «Германия», и город «de».
      const countryCodes = await fastify.prisma.country.findMany({ select: { code: true } });
      if (
        citySlugCollidesWithCountry(
          slug,
          countryCodes.map((c) => c.code),
        )
      ) {
        throw withCode(
          fastify.httpErrors.conflict(`Адрес ${slug} занят кодом страны`),
          'city_slug_country_clash',
        );
      }

      const country = await fastify.prisma.country.findUnique({ where: { id: countryId } });
      if (!country)
        throw withCode(fastify.httpErrors.badRequest('Страна не найдена'), 'country_not_found');

      const created = await fastify.prisma.city.create({
        data: {
          slug,
          name: name.de,
          countryId,
          lat,
          lng,
          isActive,
          translations: { create: translationRows(name) },
          districts: {
            create: districts.map((d) => ({
              slug: d.slug,
              name: d.name.de,
              lat: d.lat,
              lng: d.lng,
              isActive: d.isActive,
              translations: { create: translationRows(d.name) },
            })),
          },
        },
        select: cityShape,
      });

      fastify.revalidate([CITIES_TAG]);
      return reply.status(201).send(present(created));
    },
  );

  fastify.patch(
    '/admin/cities/:id',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParams,
        body: cityInputSchema.omit({ districts: true }).partial({ slug: true }),
        response: { 200: citySchemaAdmin },
      },
    },
    async (request) => {
      const { name, countryId, lat, lng, isActive } = request.body;
      // Страна анкеты денормализована из города и не меняется (цены анкет
      // лежат в валюте страны), поэтому город с анкетами в другую страну
      // не переносим.
      const current = await fastify.prisma.city.findUnique({
        where: { id: request.params.id },
        select: { countryId: true, _count: { select: { profiles: true } } },
      });
      if (!current)
        throw withCode(fastify.httpErrors.notFound('Город не найден'), 'city_not_found');
      if (!canMoveCityToCountry(current.countryId, countryId, current._count.profiles)) {
        throw withCode(
          fastify.httpErrors.conflict('В городе есть анкеты — сменить страну нельзя'),
          CITY_HAS_PROFILES,
        );
      }
      const updated = await fastify.prisma.city.update({
        where: { id: request.params.id },
        data: {
          name: name.de,
          countryId,
          lat,
          lng,
          isActive,
          translations: { deleteMany: {}, create: translationRows(name) },
        },
        select: cityShape,
      });
      fastify.revalidate([CITIES_TAG]);
      return present(updated);
    },
  );

  // ------------------------------------------------------------ монетизация

  const idParamsMon = z.object({ id: z.string().min(1) });

  fastify.get(
    '/admin/countries/:id/monetization',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParamsMon,
        response: { 200: countryMonetizationSchema },
      },
    },
    async (request) => {
      const country = await fastify.prisma.country.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!country)
        throw withCode(fastify.httpErrors.notFound('Страна не найдена'), 'country_not_found');
      return getCountryMonetization(fastify.prisma, country.id);
    },
  );

  fastify.put(
    '/admin/countries/:id/monetization',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParamsMon,
        body: countryMonetizationSchema,
        response: { 200: countryMonetizationSchema },
      },
    },
    async (request) => {
      const country = await fastify.prisma.country.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!country)
        throw withCode(fastify.httpErrors.notFound('Страна не найдена'), 'country_not_found');
      const saved = await saveCountryMonetization(fastify.prisma, country.id, request.body);
      fastify.revalidate([BILLING_TAG]);
      return saved;
    },
  );

  fastify.get(
    '/admin/cities/:id/monetization',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParamsMon,
        response: { 200: cityMonetizationSchema },
      },
    },
    async (request) => {
      const found = await getCityMonetization(fastify.prisma, request.params.id);
      if (!found) throw withCode(fastify.httpErrors.notFound('Город не найден'), 'city_not_found');
      return found;
    },
  );

  fastify.put(
    '/admin/cities/:id/monetization',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParamsMon,
        body: cityMonetizationInputSchema,
        response: { 200: cityMonetizationSchema },
      },
    },
    async (request) => {
      const saved = await saveCityMonetization(fastify.prisma, request.params.id, request.body);
      if (!saved) throw withCode(fastify.httpErrors.notFound('Город не найден'), 'city_not_found');
      fastify.revalidate([BILLING_TAG]);
      return saved;
    },
  );

  // ---------------------------------------------------------------- районы

  fastify.post(
    '/admin/cities/:id/districts',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParams,
        body: districtInputSchema,
        response: { 201: citySchemaAdmin },
      },
    },
    async (request, reply) => {
      const { slug, name, lat, lng, isActive } = request.body;
      const cityId = request.params.id;

      const clash = await fastify.prisma.district.findUnique({
        where: { cityId_slug: { cityId, slug } },
      });
      if (clash)
        throw withCode(
          fastify.httpErrors.conflict(`Район ${slug} в этом городе уже есть`),
          'district_exists',
        );

      await fastify.prisma.district.create({
        data: {
          cityId,
          slug,
          name: name.de,
          lat,
          lng,
          isActive,
          translations: { create: translationRows(name) },
        },
      });

      const city = await fastify.prisma.city.findUniqueOrThrow({
        where: { id: cityId },
        select: cityShape,
      });
      fastify.revalidate([CITIES_TAG]);
      return reply.status(201).send(present(city));
    },
  );

  fastify.patch(
    '/admin/districts/:id',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: idParams,
        body: districtInputSchema.partial({ slug: true }),
        response: { 200: citySchemaAdmin },
      },
    },
    async (request) => {
      const { name, lat, lng, isActive } = request.body;
      const updated = await fastify.prisma.district.update({
        where: { id: request.params.id },
        data: {
          name: name.de,
          lat,
          lng,
          isActive,
          translations: { deleteMany: {}, create: translationRows(name) },
        },
        select: { cityId: true },
      });

      const city = await fastify.prisma.city.findUniqueOrThrow({
        where: { id: updated.cityId },
        select: cityShape,
      });
      fastify.revalidate([CITIES_TAG]);
      return present(city);
    },
  );
  // Выключили публикацию — админ решает, что делать с уже опубликованными
  // анкетами этого типа в стране/городе: сколько их и снять ли.
  const scopeQuery = z
    .object({
      countryId: z.string().min(1).optional(),
      cityId: z.string().min(1).optional(),
      kind: placementKindSchema,
    })
    .refine((value) => (value.countryId === undefined) !== (value.cityId === undefined), {
      message: 'Нужно указать ровно одно: страну или город',
    });

  const publishedWhere = (q: z.infer<typeof scopeQuery>) => ({
    status: 'published' as const,
    owner: { advertiserKind: q.kind },
    ...(q.countryId ? { countryId: q.countryId } : { cityId: q.cityId }),
  });

  fastify.get(
    '/admin/placement-rules/published-count',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        querystring: scopeQuery,
        response: { 200: z.object({ count: z.number().int().nonnegative() }) },
      },
    },
    async (request) => ({
      count: await fastify.prisma.profile.count({ where: publishedWhere(request.query) }),
    }),
  );

  /** Снять с публикации (в «паузу») все опубликованные анкеты этого типа в месте. */
  fastify.post(
    '/admin/placement-rules/pause-published',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        body: scopeQuery,
        response: { 200: z.object({ paused: z.number().int().nonnegative() }) },
      },
    },
    async (request) => {
      const where = publishedWhere(request.body);
      const rows = await fastify.prisma.profile.findMany({ where, select: { slug: true } });
      const { count } = await fastify.prisma.profile.updateMany({
        where,
        data: { status: 'paused' },
      });
      // Анкеты пропадают из каталога сразу, а не по истечении кэша.
      fastify.revalidate([PROFILES_TAG, ...rows.map((row) => profileTag(row.slug))]);
      return { paused: count };
    },
  );

  // ------------------------------------------------- правила размещения

  fastify.get(
    '/admin/placement-rules',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], response: { 200: z.array(placementRuleSchema) } },
    },
    async () => {
      const rows = await fastify.prisma.placementRule.findMany({
        select: { countryId: true, cityId: true, kind: true, paid: true, allowed: true },
      });
      return rows;
    },
  );

  /**
   * Задать правило для страны или города и типа рекламодателя. Оба поля
   * пустые — правило удаляется: строка без переопределений ничего не значит.
   */
  fastify.put(
    '/admin/placement-rules',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        body: placementRuleInputSchema,
        response: { 200: z.array(placementRuleSchema) },
      },
    },
    async (request) => {
      const { countryId, cityId, kind, paid, allowed } = request.body;

      if (countryId) {
        const exists = await fastify.prisma.country.findUnique({ where: { id: countryId } });
        if (!exists)
          throw withCode(fastify.httpErrors.notFound('Страна не найдена'), 'country_not_found');
      } else if (cityId) {
        const exists = await fastify.prisma.city.findUnique({ where: { id: cityId } });
        if (!exists)
          throw withCode(fastify.httpErrors.notFound('Город не найден'), 'city_not_found');
      }

      const scope = countryId ? { countryId } : { cityId };
      const existing = await fastify.prisma.placementRule.findFirst({
        where: { ...scope, kind },
        select: { id: true, paid: true },
      });

      if (paid === null && allowed === null) {
        if (existing) await fastify.prisma.placementRule.delete({ where: { id: existing.id } });
      } else if (existing) {
        await fastify.prisma.placementRule.update({
          where: { id: existing.id },
          data: { paid, allowed },
        });
      } else {
        await fastify.prisma.placementRule.create({ data: { ...scope, kind, paid, allowed } });
      }

      // Правило могло сделать место бесплатным (или платным): Premium меняется.
      await syncPremiumForPlace(fastify.prisma, scope, kind);

      // Бесплатно → платно: владельцам без подписки даём льготный срок, а не
      // снимаем анкеты в тот же миг. Обратный переход льготу снимает.
      if (countryId) {
        const wasPaid = existing?.paid ?? true;
        const isPaid = paid ?? true;
        await startPlacementGrace(fastify.prisma, { countryId }, kind, {
          // Выдаём льготу только при самом переходе: правка другого поля
          // правила не должна давать новый срок.
          grant: !wasPaid && isPaid,
          graceDays: env.LISTING_GRACE_DAYS,
          notify: (mail) => pushMail(fastify.redis, mail),
        });
      }

      return fastify.prisma.placementRule.findMany({
        select: { countryId: true, cityId: true, kind: true, paid: true, allowed: true },
      });
    },
  );
};
