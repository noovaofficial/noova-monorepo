/**
 * Каталог услуг из админки (N-36).
 *
 * Доступ — только `admin`. Удаления нет: услуга может быть выбрана в анкетах,
 * и удаление порвало бы связи. Вместо него отключение — то же правило, что
 * у географии и в сиде справочников.
 */
import {
  type AdminServiceGroup,
  adminServiceGroupSchema,
  LOCALES,
  serviceGroupInputSchema,
  serviceInputSchema,
  type Translated,
  toTranslated,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/** Строки переводов в объект; неполный набор — след прежних версий каталога. */
function fromRows(rows: { locale: string; name: string }[], fallback: string): Translated {
  return (
    toTranslated(rows) ?? (Object.fromEntries(LOCALES.map((l) => [l, fallback])) as Translated)
  );
}

const translationRows = (name: Translated) =>
  LOCALES.map((locale) => ({ locale, name: name[locale] }));

export const serviceCatalogRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const guard = fastify.requireRole('admin');

  /** Полный каталог: группы в порядке первой услуги, услуги — по position. */
  async function present(): Promise<AdminServiceGroup[]> {
    const [services, groupRows] = await Promise.all([
      fastify.prisma.service.findMany({
        orderBy: [{ position: 'asc' }, { key: 'asc' }],
        select: {
          id: true,
          key: true,
          group: true,
          appliesTo: true,
          position: true,
          isActive: true,
          translations: { select: { locale: true, name: true } },
          _count: { select: { profiles: true } },
        },
      }),
      fastify.prisma.serviceGroupTranslation.findMany({
        select: { groupKey: true, locale: true, name: true },
      }),
    ]);

    const byGroup = new Map<string, { locale: string; name: string }[]>();
    for (const row of groupRows) {
      const list = byGroup.get(row.groupKey) ?? [];
      list.push(row);
      byGroup.set(row.groupKey, list);
    }

    const groups: AdminServiceGroup[] = [];
    for (const service of services) {
      let bucket = groups.find((g) => g.key === service.group);
      if (!bucket) {
        bucket = {
          key: service.group,
          name: fromRows(byGroup.get(service.group) ?? [], service.group),
          services: [],
        };
        groups.push(bucket);
      }
      bucket.services.push({
        id: service.id,
        key: service.key,
        group: service.group,
        name: fromRows(service.translations, service.key),
        appliesTo: service.appliesTo,
        position: service.position,
        isActive: service.isActive,
        profileCount: service._count.profiles,
      });
    }

    // Группа без единой услуги в каталоге не показалась бы вовсе — а её
    // только что могли завести, чтобы наполнять. Добавляем такие в конец.
    for (const key of byGroup.keys()) {
      if (!groups.some((g) => g.key === key)) {
        groups.push({ key, name: fromRows(byGroup.get(key) ?? [], key), services: [] });
      }
    }

    return groups;
  }

  fastify.get(
    '/admin/services',
    {
      onRequest: guard,
      schema: { tags: ['admin'], response: { 200: z.array(adminServiceGroupSchema) } },
    },
    async () => present(),
  );

  fastify.post(
    '/admin/service-groups',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        body: serviceGroupInputSchema,
        response: { 201: z.array(adminServiceGroupSchema) },
      },
    },
    async (request, reply) => {
      const { key, name } = request.body;

      const exists = await fastify.prisma.serviceGroupTranslation.findFirst({
        where: { groupKey: key },
        select: { id: true },
      });
      if (exists) throw fastify.httpErrors.conflict(`Группа ${key} уже есть`);

      await fastify.prisma.serviceGroupTranslation.createMany({
        data: translationRows(name).map((row) => ({ groupKey: key, ...row })),
      });

      return reply.status(201).send(await present());
    },
  );

  fastify.patch(
    '/admin/service-groups/:key',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        params: z.object({ key: z.string().min(1) }),
        body: serviceGroupInputSchema.omit({ key: true }),
        response: { 200: z.array(adminServiceGroupSchema) },
      },
    },
    async (request) => {
      const { key } = request.params;
      // Переводы переписываем целиком: точечное обновление оставило бы
      // строки от прошлых локалей.
      await fastify.prisma.$transaction([
        fastify.prisma.serviceGroupTranslation.deleteMany({ where: { groupKey: key } }),
        fastify.prisma.serviceGroupTranslation.createMany({
          data: translationRows(request.body.name).map((row) => ({ groupKey: key, ...row })),
        }),
      ]);
      return present();
    },
  );

  fastify.post(
    '/admin/services',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        body: serviceInputSchema,
        response: { 201: z.array(adminServiceGroupSchema) },
      },
    },
    async (request, reply) => {
      const { key, group, name, appliesTo, position, isActive } = request.body;

      const exists = await fastify.prisma.service.findUnique({ where: { key } });
      if (exists) throw fastify.httpErrors.conflict(`Услуга ${key} уже есть`);

      const groupExists = await fastify.prisma.serviceGroupTranslation.findFirst({
        where: { groupKey: group },
        select: { id: true },
      });
      if (!groupExists) throw fastify.httpErrors.badRequest(`Группы ${group} нет`);

      await fastify.prisma.service.create({
        data: {
          key,
          group,
          appliesTo,
          position,
          isActive,
          translations: { create: translationRows(name) },
        },
      });

      return reply.status(201).send(await present());
    },
  );

  fastify.patch(
    '/admin/services/:id',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        // Ключ не меняется: он лежит в анкетах и в адресах фильтров каталога.
        body: serviceInputSchema.omit({ key: true }),
        response: { 200: z.array(adminServiceGroupSchema) },
      },
    },
    async (request) => {
      const { group, name, appliesTo, position, isActive } = request.body;

      const groupExists = await fastify.prisma.serviceGroupTranslation.findFirst({
        where: { groupKey: group },
        select: { id: true },
      });
      if (!groupExists) throw fastify.httpErrors.badRequest(`Группы ${group} нет`);

      await fastify.prisma.service.update({
        where: { id: request.params.id },
        data: {
          group,
          appliesTo,
          position,
          isActive,
          translations: { deleteMany: {}, create: translationRows(name) },
        },
      });

      return present();
    },
  );
};
