import { revealedContactsSchema, slugSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

/**
 * Раскрытие контактов агентства — тот же гейт, что у анкеты (payments.md
 * никак не связан, см. N-31/N-08 в planning.md): значения не в публичном
 * представлении компании, а только здесь, по явному нажатию.
 *
 * Отдельный маршрут от `/profiles/:slug/contacts/reveal`, а не тот же с
 * параметром: модели разные (`Company`/`CompanyContact`), и журналировать
 * раскрытие профильным `recordProfileEvent` (жёстко привязан к `Profile`)
 * здесь всё равно нельзя — антифрод для агентства ограничивается лимитом.
 */
export const companyRevealRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.post(
    '/companies/:slug/contacts/reveal',
    {
      // Тот же смысл лимита, что у анкеты: не про нагрузку, про приватность
      // владельца контакта — снимать для кого бы то ни было нельзя.
      config: { rateLimit: { max: 20, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['profiles'],
        params: z.object({ slug: slugSchema }),
        response: { 200: revealedContactsSchema },
      },
    },
    async (request) => {
      const company = await fastify.prisma.company.findFirst({
        // Отключённая компания недоступна целиком — раскрытие не должно
        // быть обходным путём к ней.
        where: { slug: request.params.slug, isActive: true },
        select: {
          contacts: { orderBy: { position: 'asc' }, select: { type: true, value: true } },
        },
      });
      if (!company) throw fastify.httpErrors.notFound('Компания не найдена');

      return {
        contacts: company.contacts.map((c) => ({ type: c.type, value: c.value })),
      };
    },
  );
};
