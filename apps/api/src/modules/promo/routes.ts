import { promoSlotSchema } from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { mediaUrl } from '../../mappers.js';

export const promoRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/promo',
    {
      schema: {
        tags: ['promo'],
        querystring: z.object({
          city: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(12).default(6),
        }),
        response: { 200: z.array(promoSlotSchema) },
      },
    },
    async (request) => {
      const now = new Date();
      const rows = await fastify.prisma.promoSlot.findMany({
        where: {
          isActive: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
          ...(request.query.city
            ? { profile: { city: { slug: request.query.city }, status: 'published' } }
            : {}),
        },
        orderBy: { position: 'asc' },
        take: request.query.limit,
        select: {
          id: true,
          title: true,
          subtitle: true,
          href: true,
          imageKey: true,
          profile: {
            select: {
              slug: true,
              city: { select: { slug: true, name: true, countryCode: true } },
            },
          },
        },
      });

      return rows.map((row) => ({
        id: row.id,
        profileSlug: row.profile?.slug ?? null,
        href: row.href,
        title: row.title,
        subtitle: row.subtitle,
        imageUrl: row.imageKey ? mediaUrl(row.imageKey) : null,
        city: row.profile?.city ?? null,
      }));
    },
  );
};
