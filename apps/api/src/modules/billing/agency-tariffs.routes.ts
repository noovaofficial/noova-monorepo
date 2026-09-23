import {
  agencyTariffGridSchema,
  agencyTariffTierInputSchema,
  agencyTariffTierSchema,
  agencyTopStateSchema,
  companyTariffOverrideInputSchema,
  companyTariffStateSchema,
  grantAgencyTopResultSchema,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BILLING_TAG, PROFILES_TAG } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import {
  companyTariffSelect,
  createAgencyTariffTier,
  deleteAgencyTariffTier,
  loadAgencyTariffGrid,
  presentCompanyTariffState,
  TariffTierInUseError,
  TariffTierNotFoundError,
  updateAgencyTariffTier,
} from './agency-tariffs.js';
import {
  AgencyTopFullError,
  AgencyTopNoCompanyError,
  agencyTopState,
  grantAgencyTop,
} from './agency-top.js';
import { loadBillingConfig } from './config.js';

/**
 * Сетка тарифов агентств (payments.md §3.3, D-13), индивидуальный override
 * и ТОП конкретного агентства (D-14) — денежные решения, доступные только
 * администратору. Просмотр карточки агентства (тариф, бан, ТОП) — персоналу
 * целиком: объединённая карточка в модерации открыта и модератору, деньгами
 * там распоряжается только админ (см. `staffGuard`/`guard` по маршрутам).
 */
export const agencyTariffRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const guard = fastify.requireRole('admin');
  const staffGuard = fastify.requireRole('moderator', 'admin');

  // --- Общая сетка тарифов -------------------------------------------------

  fastify.get(
    '/admin/agency-tariffs',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], response: { 200: agencyTariffGridSchema } },
    },
    async () => loadAgencyTariffGrid(fastify.prisma),
  );

  fastify.post(
    '/admin/agency-tariffs',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        body: agencyTariffTierInputSchema,
        response: { 201: agencyTariffTierSchema },
      },
    },
    async (request, reply) => {
      const created = await createAgencyTariffTier(fastify.prisma, request.body);
      fastify.revalidate([BILLING_TAG]);
      return reply.status(201).send(created);
    },
  );

  fastify.patch(
    '/admin/agency-tariffs/:id',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        body: agencyTariffTierInputSchema,
        response: { 200: agencyTariffTierSchema },
      },
    },
    async (request) => {
      try {
        const updated = await updateAgencyTariffTier(
          fastify.prisma,
          request.params.id,
          request.body,
        );
        fastify.revalidate([BILLING_TAG]);
        return updated;
      } catch (error) {
        if (error instanceof TariffTierNotFoundError) {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
    },
  );

  /**
   * Тариф, назначенный хотя бы одной компании, не удаляется: слепой
   * `SetNull` со стороны сервера — это агентство, которое незаметно осталось
   * без тарифа. Тариф сначала снимают со всех, потом удаляют.
   */
  fastify.delete(
    '/admin/agency-tariffs/:id',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      try {
        await deleteAgencyTariffTier(fastify.prisma, request.params.id);
        fastify.revalidate([BILLING_TAG]);
        return reply.status(204).send(null);
      } catch (error) {
        if (error instanceof TariffTierInUseError) {
          throw fastify.httpErrors.conflict(
            `Тариф назначен ${error.companyCount} агентствам, удалить нельзя`,
          );
        }
        if (error instanceof TariffTierNotFoundError) {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
    },
  );

  // --- Карточка конкретного агентства: тариф, override, бан, ТОП -----------
  // Список агентств для навигации — общий `/moderation/users?advertiserKind=agency`
  // (People → Agencies), отдельного списка компаний больше нет.

  fastify.get(
    '/admin/companies/:id/tariff',
    {
      onRequest: staffGuard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: companyTariffStateSchema },
      },
    },
    async (request) => {
      const row = await fastify.prisma.company.findUnique({
        where: { id: request.params.id },
        select: companyTariffSelect,
      });
      if (!row) throw fastify.httpErrors.notFound('Компания не найдена');

      const profiles = await fastify.prisma.profile.findMany({
        where: { companyId: row.id },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          slug: true,
          displayName: true,
          status: true,
          isVerified: true,
          isFeatured: true,
          city: { select: { name: true } },
        },
      });

      const state = await presentCompanyTariffState(fastify.prisma, row, profiles.length);
      return {
        ...state,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          slug: profile.slug,
          displayName: profile.displayName,
          status: profile.status,
          cityName: profile.city.name,
          isVerified: profile.isVerified,
          isFeatured: profile.isFeatured,
        })),
      };
    },
  );

  /**
   * Ручной override — грант, а не покупка: баланс агентства не трогаем.
   * Админ выдаёт индивидуальный лимит или тариф по договорённости вне сетки.
   */
  fastify.put(
    '/admin/companies/:id/tariff',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        body: companyTariffOverrideInputSchema,
        response: { 200: companyTariffStateSchema },
      },
    },
    async (request) => {
      const existing = await fastify.prisma.company.findUnique({
        where: { id: request.params.id },
        select: { id: true },
      });
      if (!existing) throw fastify.httpErrors.notFound('Компания не найдена');

      if (request.body.tariffTierId) {
        const tier = await fastify.prisma.agencyTariffTier.findUnique({
          where: { id: request.body.tariffTierId },
          select: { id: true },
        });
        if (!tier) throw fastify.httpErrors.badRequest('Тариф не найден');
      }

      const updated = await fastify.prisma.company.update({
        where: { id: request.params.id },
        data: {
          tariffTierId: request.body.tariffTierId,
          customProfileLimit: request.body.customProfileLimit,
          customPriceM1Gc: request.body.customPrices.m1,
          customPriceM6Gc: request.body.customPrices.m6,
          customPriceM12Gc: request.body.customPrices.m12,
        },
        select: companyTariffSelect,
      });

      const profileCount = await fastify.prisma.profile.count({
        where: { companyId: updated.id },
      });
      return presentCompanyTariffState(fastify.prisma, updated, profileCount);
    },
  );

  // --- ТОП конкретного агентства (payments.md §3.5, D-14) -------------------

  fastify.get(
    '/admin/companies/:id/top',
    {
      onRequest: staffGuard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: agencyTopStateSchema },
      },
    },
    async (request) => {
      const company = await fastify.prisma.company.findUnique({
        where: { id: request.params.id },
        select: { ownerId: true },
      });
      if (!company) throw fastify.httpErrors.notFound('Компания не найдена');

      const config = await loadBillingConfig(fastify.prisma);
      return agencyTopState(fastify.prisma, company.ownerId, config.agencyTop);
    },
  );

  /**
   * Выдача ТОПа агентству без оплаты — обход платежа, только админ (как и
   * прочие денежные решения в этом файле).
   */
  fastify.post(
    '/admin/companies/:id/top',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: grantAgencyTopResultSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const config = await loadBillingConfig(fastify.prisma);

      try {
        const result = await grantAgencyTop(fastify.prisma, {
          companyId: request.params.id,
          slots: config.agencyTop.slots,
        });

        await fastify.prisma.moderationAction.create({
          data: {
            moderatorId: userId,
            subjectType: 'company',
            subjectId: request.params.id,
            decision: 'approved',
            reason: result.extended
              ? 'ТОП агентства продлён администратором'
              : 'ТОП агентства выдан администратором',
          },
        });

        fastify.revalidate([PROFILES_TAG]);
        return { placement: result.placement };
      } catch (error) {
        if (error instanceof AgencyTopFullError) {
          throw fastify.httpErrors.conflict(`Все ${error.slots} мест в ТОПе заняты`);
        }
        if (error instanceof AgencyTopNoCompanyError) {
          throw fastify.httpErrors.conflict(error.message);
        }
        throw error;
      }
    },
  );
};
