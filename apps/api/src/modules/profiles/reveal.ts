import { createHash } from 'node:crypto';
import { revealedContactsSchema, slugSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env.js';

/**
 * Журнал раскрытий не должен сам стать базой персональных данных: адрес
 * посетителя в нём лежит хэшем с общей солью. Соль постоянная, иначе
 * записи одного человека перестанут схлопываться и журнал потеряет смысл
 * как антифрод; из-за этого хэш обратим перебором адресов — поэтому строки
 * и живут ограниченный срок, а не вечно.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env.IP_HASH_SALT}:${ip}`).digest('hex');
}

export const revealRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/profiles/:slug/contacts/reveal',
    {
      // Сдерживание массового сбора: вход не требуется (см. решение 2 в
      // documentation/planning/planning.md), поэтому вся защита — здесь и в журнале.
      //
      // `allowList` глушим намеренно: общее освобождение существует ради
      // серверного рендера, который упирался бы в лимит посетителя. Этот
      // лимит — не про пропускную способность, а про приватность владелицы,
      // и снимать его нельзя ни для кого. Легитимного серверного вызова
      // здесь и нет: контакты запрашивает только браузер по нажатию.
      config: { rateLimit: { max: 20, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['profiles'],
        params: z.object({ slug: slugSchema }),
        response: { 200: revealedContactsSchema },
      },
    },
    async (request) => {
      const profile = await fastify.prisma.profile.findFirst({
        // Контакты неопубликованной анкеты недоступны никому: сама анкета
        // тоже отдаёт 404, и раскрытие не должно быть обходным путём к ней.
        where: { slug: request.params.slug, status: 'published' },
        select: {
          id: true,
          contacts: { orderBy: { position: 'asc' }, select: { type: true, value: true } },
        },
      });

      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      // Журнал пишем и при пустом списке: попытка добраться до контактов —
      // это то же событие, и для антифрода важна именно она.
      await fastify.prisma.contactReveal.create({
        data: {
          profileId: profile.id,
          // Сессия читается на каждом запросе и здесь просто может отсутствовать.
          userId: request.session?.userId ?? null,
          ipHash: hashIp(request.ip),
        },
      });

      return {
        contacts: profile.contacts.map((c) => ({ type: c.type, value: c.value })),
      };
    },
  );
};
