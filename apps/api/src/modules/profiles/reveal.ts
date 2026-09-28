import { revealedContactsSchema, slugSchema, trackEventContextSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { recordProfileEvent } from '../analytics/events.js';

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
        // Опционально: старые клиенты и прямые вызовы без тела не должны
        // ломаться, просто раскрытие пойдёт без антибот-сигналов 3 и 4.
        body: trackEventContextSchema.optional(),
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
          kind: true,
          city: { select: { slug: true } },
          contacts: { orderBy: { position: 'asc' }, select: { type: true, value: true } },
        },
      });

      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      // Журнал пишем и при пустом списке: попытка добраться до контактов —
      // это то же событие, и для антифрода важна именно она.
      await recordProfileEvent(fastify, request, {
        kind: 'contact_reveal',
        profileId: profile.id,
        city: profile.city.slug,
        category: profile.kind,
        sessionId: request.body?.sessionId,
        interacted: request.body?.interacted,
        msSincePageLoad: request.body?.msSincePageLoad,
      });

      return {
        contacts: profile.contacts.map((c) => ({ type: c.type, value: c.value })),
      };
    },
  );
};
