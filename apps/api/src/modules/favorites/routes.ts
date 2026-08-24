import { favoriteIdsSchema, favoriteItemSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { localeQuerySchema } from '../../i18n.js';
import { toProfileCard } from '../../mappers.js';
import { requireSession } from '../../plugins/session.js';
import { cardSelect } from '../profiles/routes.js';

export const favoriteRoutes: FastifyPluginAsyncZod = async (fastify) => {
  /**
   * Избранное — функция клиента. Рекламодателю и персоналу оно не нужно:
   * каталога у них нет, отмечать нечего. Проверяем роль, а не «есть сессия»,
   * иначе владелица анкеты собирала бы себе список конкуренток.
   */
  const onlyClient = { onRequest: fastify.requireRole('client') };

  fastify.get(
    '/me/favorites',
    {
      ...onlyClient,
      schema: {
        tags: ['favorites'],
        querystring: localeQuerySchema,
        response: { 200: z.array(favoriteItemSchema) },
      },
    },
    async (request) => {
      const rows = await fastify.prisma.favorite.findMany({
        where: { clientId: requireSession(request).userId },
        orderBy: { createdAt: 'desc' },
        // Снятую с публикации анкету не отфильтровываем: она остаётся
        // в списке с пометкой, иначе карточка исчезает без объяснения.
        select: {
          createdAt: true,
          profile: { select: { ...cardSelect(request.query.locale), status: true } },
        },
      });

      return rows.map((row) => ({
        profile: toProfileCard(row.profile),
        addedAt: row.createdAt.toISOString(),
        isAvailable: row.profile.status === 'published',
      }));
    },
  );

  fastify.get(
    '/me/favorites/ids',
    {
      ...onlyClient,
      schema: { tags: ['favorites'], response: { 200: favoriteIdsSchema } },
    },
    async (request) => {
      const rows = await fastify.prisma.favorite.findMany({
        where: { clientId: requireSession(request).userId },
        select: { profileId: true },
      });
      return { ids: rows.map((row) => row.profileId) };
    },
  );

  fastify.put(
    '/me/favorites/:profileId',
    {
      ...onlyClient,
      schema: {
        tags: ['favorites'],
        params: z.object({ profileId: z.string().min(1) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);

      // Отметить можно только опубликованную анкету: черновики и снятые
      // наружу не видны, и добавление по прямому id стало бы способом
      // узнать, что такая анкета вообще существует.
      const profile = await fastify.prisma.profile.findFirst({
        where: { id: request.params.profileId, status: 'published' },
        select: { id: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      // PUT идемпотентен по определению: повторное нажатие не должно ни
      // создавать дубль, ни падать конфликтом. Составной ключ и upsert
      // дают это без предварительной проверки и без гонки.
      await fastify.prisma.favorite.upsert({
        where: { clientId_profileId: { clientId: userId, profileId: profile.id } },
        create: { clientId: userId, profileId: profile.id },
        update: {},
      });

      return reply.status(204).send(null);
    },
  );

  fastify.delete(
    '/me/favorites/:profileId',
    {
      ...onlyClient,
      schema: {
        tags: ['favorites'],
        params: z.object({ profileId: z.string().min(1) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      // deleteMany, а не delete: отсутствующей строки не ошибка. Клиент
      // снимает отметку — «отметки нет» достигнуто в обоих случаях.
      await fastify.prisma.favorite.deleteMany({
        where: {
          clientId: requireSession(request).userId,
          profileId: request.params.profileId,
        },
      });
      return reply.status(204).send(null);
    },
  );
};
