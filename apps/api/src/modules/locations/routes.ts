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
  citySchemaAdmin,
  countryInputSchema,
  countrySchema,
  districtInputSchema,
  LOCALES,
  type Translated,
  toTranslated,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

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
          translations: { select: { locale: true, name: true } },
          _count: { select: { cities: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: fromRows(row.translations, row.name),
        isActive: row.isActive,
        cityCount: row._count.cities,
      }));
    },
  );

  fastify.post(
    '/admin/countries',
    {
      onRequest: guard,
      schema: { tags: ['admin'], body: countryInputSchema, response: { 201: countrySchema } },
    },
    async (request, reply) => {
      const { code, name, isActive } = request.body;

      const exists = await fastify.prisma.country.findUnique({ where: { code } });
      if (exists) throw fastify.httpErrors.conflict(`Страна ${code} уже заведена`);

      const created = await fastify.prisma.country.create({
        data: {
          code,
          name: name.de,
          isActive,
          translations: { create: translationRows(name) },
        },
        select: { id: true, code: true, isActive: true },
      });

      return reply.status(201).send({ ...created, name, cityCount: 0 });
    },
  );

  fastify.patch(
    '/admin/countries/:id',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        params: idParams,
        body: countryInputSchema.partial({ code: true }),
        response: { 200: countrySchema },
      },
    },
    async (request) => {
      const { name, isActive } = request.body;
      const updated = await fastify.prisma.country.update({
        where: { id: request.params.id },
        data: {
          name: name.de,
          isActive,
          // Переводы переписываем целиком: частичный набор невозможен по
          // контракту, а точечное обновление оставило бы строки от прошлых локалей.
          translations: { deleteMany: {}, create: translationRows(name) },
        },
        select: { id: true, code: true, isActive: true, _count: { select: { cities: true } } },
      });
      return {
        id: updated.id,
        code: updated.code,
        name,
        isActive: updated.isActive,
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
      schema: { tags: ['admin'], body: cityInputSchema, response: { 201: citySchemaAdmin } },
    },
    async (request, reply) => {
      const { slug, name, countryId, lat, lng, isActive, districts } = request.body;

      const exists = await fastify.prisma.city.findUnique({ where: { slug } });
      if (exists) throw fastify.httpErrors.conflict(`Город ${slug} уже заведён`);

      const country = await fastify.prisma.country.findUnique({ where: { id: countryId } });
      if (!country) throw fastify.httpErrors.badRequest('Страна не найдена');

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

      return reply.status(201).send(present(created));
    },
  );

  fastify.patch(
    '/admin/cities/:id',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        params: idParams,
        body: cityInputSchema.omit({ districts: true }).partial({ slug: true }),
        response: { 200: citySchemaAdmin },
      },
    },
    async (request) => {
      const { name, countryId, lat, lng, isActive } = request.body;
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
      return present(updated);
    },
  );

  // ---------------------------------------------------------------- районы

  fastify.post(
    '/admin/cities/:id/districts',
    {
      onRequest: guard,
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
      if (clash) throw fastify.httpErrors.conflict(`Район ${slug} в этом городе уже есть`);

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
      return reply.status(201).send(present(city));
    },
  );

  fastify.patch(
    '/admin/districts/:id',
    {
      onRequest: guard,
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
      return present(city);
    },
  );
};
