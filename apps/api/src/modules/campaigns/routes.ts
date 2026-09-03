import type { Locale } from '@noova/shared';
import {
  type Campaign,
  campaignInputSchema,
  campaignRewardSchema,
  campaignSchema,
  redeemErrorSchema,
  redeemPromoInputSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { localeQuerySchema, localized, translationSelect } from '../../i18n.js';
import { requireSession } from '../../plugins/session.js';
import { RedeemFailed, redeemPromoCode } from './service.js';

const rowSelect = (locale: Locale) =>
  ({
    id: true,
    name: true,
    trigger: true,
    code: true,
    isActive: true,
    startsAt: true,
    endsAt: true,
    cityId: true,
    advertiserKind: true,
    quota: true,
    rewardGc: true,
    rewardListingDays: true,
    createdAt: true,
    city: { select: { translations: translationSelect(locale) } },
    _count: { select: { grants: true } },
  }) as const;

type Row = {
  id: string;
  name: string;
  trigger: Campaign['trigger'];
  code: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  cityId: string | null;
  advertiserKind: Campaign['advertiserKind'];
  quota: number | null;
  rewardGc: number;
  rewardListingDays: number;
  createdAt: Date;
  city: { translations: { name: string }[] } | null;
  _count: { grants: number };
};

function toCampaign(row: Row): Campaign {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger,
    code: row.code,
    isActive: row.isActive,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    cityId: row.cityId,
    cityName: row.city ? localized(row.city.translations, '') : null,
    advertiserKind: row.advertiserKind,
    quota: row.quota,
    rewardGc: row.rewardGc,
    rewardListingDays: row.rewardListingDays,
    // Из журнала выдач, а не из отдельного поля: счётчик рядом с журналом
    // рано или поздно разошёлся бы с ним, и восстановить правду было бы нечем.
    grantedCount: row._count.grants,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Входные даты приходят строками ISO; в базе — `Date` либо `null`. */
const at = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

export const campaignRoutes: FastifyPluginAsyncZod = async (fastify) => {
  /**
   * Акциями распоряжается только админ. Модератор разбирает очередь, а
   * раздача размещений и монет — решение владельца продукта: тем же
   * рассуждением закрыты «Монетизация» и «Операции».
   */
  const guard = fastify.requireRole('admin');

  fastify.get(
    '/admin/campaigns',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        querystring: localeQuerySchema,
        response: { 200: z.array(campaignSchema) },
      },
    },
    async (request) => {
      const rows = await fastify.prisma.campaign.findMany({
        select: rowSelect(request.query.locale),
        // Новые сверху: заводят их подряд, и разбирают тоже последние.
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => toCampaign(row as Row));
    },
  );

  fastify.post(
    '/admin/campaigns',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        querystring: localeQuerySchema,
        body: campaignInputSchema,
        response: { 201: campaignSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const input = request.body;

      const row = await fastify.prisma.campaign
        .create({
          data: {
            name: input.name,
            trigger: input.trigger,
            code: input.code,
            isActive: input.isActive,
            startsAt: at(input.startsAt),
            endsAt: at(input.endsAt),
            cityId: input.cityId,
            advertiserKind: input.advertiserKind,
            quota: input.quota,
            rewardGc: input.rewardGc,
            rewardListingDays: input.rewardListingDays,
            createdById: userId,
          },
          select: rowSelect(request.query.locale),
        })
        .catch((error: { code?: string }) => {
          // Код уникален: два предложения под одним кодом — это акция,
          // про которую нельзя сказать, какая из них применится.
          if (error.code === 'P2002') {
            throw fastify.httpErrors.conflict('Такой промокод уже занят');
          }
          throw error;
        });

      return reply.status(201).send(toCampaign(row as Row));
    },
  );

  fastify.patch(
    '/admin/campaigns/:id',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        querystring: localeQuerySchema,
        body: campaignInputSchema,
        response: { 200: campaignSchema },
      },
    },
    async (request) => {
      const input = request.body;
      const exists = await fastify.prisma.campaign.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!exists) throw fastify.httpErrors.notFound('Акция не найдена');

      const row = await fastify.prisma.campaign
        .update({
          where: { id: request.params.id },
          data: {
            name: input.name,
            trigger: input.trigger,
            code: input.code,
            isActive: input.isActive,
            startsAt: at(input.startsAt),
            endsAt: at(input.endsAt),
            cityId: input.cityId,
            advertiserKind: input.advertiserKind,
            quota: input.quota,
            rewardGc: input.rewardGc,
            rewardListingDays: input.rewardListingDays,
          },
          select: rowSelect(request.query.locale),
        })
        .catch((error: { code?: string }) => {
          if (error.code === 'P2002') {
            throw fastify.httpErrors.conflict('Такой промокод уже занят');
          }
          throw error;
        });

      return toCampaign(row as Row);
    },
  );

  /**
   * Удаление акции. Разрешено только пока по ней ничего не выдали: выдачи —
   * это journal того, кому и что мы подарили, и каскадом стирать его нельзя.
   * Отработавшую акцию выключают, а не удаляют.
   */
  fastify.delete(
    '/admin/campaigns/:id',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const granted = await fastify.prisma.campaignGrant.count({
        where: { campaignId: request.params.id },
      });
      if (granted > 0) {
        throw fastify.httpErrors.conflict(
          'По акции уже были выдачи — её можно выключить, но не удалить',
        );
      }

      const { count } = await fastify.prisma.campaign.deleteMany({
        where: { id: request.params.id },
      });
      if (count === 0) throw fastify.httpErrors.notFound('Акция не найдена');

      return reply.status(204).send(null);
    },
  );

  /**
   * Ввод промокода в кабинете.
   *
   * Лимит жёсткий и без освобождения: перебор кодов — это перебор чужих
   * подарков, и защита здесь важнее удобства того, кто ошибся трижды.
   */
  fastify.post(
    '/me/promo',
    {
      onRequest: fastify.requireRole('advertiser'),
      config: { rateLimit: { max: 10, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['billing'],
        body: redeemPromoInputSchema,
        response: {
          200: campaignRewardSchema,
          409: z.object({ reason: redeemErrorSchema }),
        },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          advertiserKind: true,
          // Город берётся с первой анкеты: у учётной записи его нет.
          profiles: { select: { cityId: true }, orderBy: { createdAt: 'asc' }, take: 1 },
        },
      });
      if (!user?.advertiserKind) {
        throw fastify.httpErrors.forbidden('Доступно только рекламодателям');
      }

      try {
        return await redeemPromoCode(fastify.prisma, request.body.code, {
          userId,
          advertiserKind: user.advertiserKind,
          cityId: user.profiles[0]?.cityId ?? null,
        });
      } catch (error) {
        // Отказ по условиям — не ошибка сервера и не ошибка ввода: это
        // нормальный исход, у которого есть причина, и её надо показать.
        if (error instanceof RedeemFailed) {
          return reply.status(409).send({ reason: error.reason });
        }
        throw error;
      }
    },
  );
};
