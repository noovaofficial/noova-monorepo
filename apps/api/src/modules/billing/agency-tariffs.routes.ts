import {
  adminCompanySummarySchema,
  agencyTariffGridSchema,
  agencyTariffTierInputSchema,
  agencyTariffTierSchema,
  companyTariffOverrideInputSchema,
  companyTariffStateSchema,
  effectiveProfileLimit,
} from '@noova/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BILLING_TAG } from '../../plugins/revalidate.js';
import {
  companyTariffSelect,
  createAgencyTariffTier,
  deleteAgencyTariffTier,
  loadAgencyTariffGrid,
  presentCompanyTariffState,
  TariffTierInUseError,
  TariffTierNotFoundError,
  tariffOf,
  updateAgencyTariffTier,
} from './agency-tariffs.js';

/**
 * Сетка тарифов агентств (payments.md §3.3, D-13) и ручной override для
 * конкретного агентства — обе стороны монетизации по числу анкет, доступные
 * только администратору.
 */
export const agencyTariffRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const guard = fastify.requireRole('admin');

  // --- Общая сетка тарифов -------------------------------------------------

  fastify.get(
    '/admin/agency-tariffs',
    { onRequest: guard, schema: { tags: ['admin'], response: { 200: agencyTariffGridSchema } } },
    async () => loadAgencyTariffGrid(fastify.prisma),
  );

  fastify.post(
    '/admin/agency-tariffs',
    {
      onRequest: guard,
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

  // --- Список агентств и индивидуальный override ---------------------------

  fastify.get(
    '/admin/companies',
    {
      onRequest: guard,
      schema: {
        tags: ['admin'],
        querystring: z.object({
          query: z.string().trim().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.array(adminCompanySummarySchema) },
      },
    },
    async (request) => {
      const { query, limit } = request.query;
      const rows = await fastify.prisma.company.findMany({
        where: {
          kind: 'agency',
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' as const } },
                  { slug: { contains: query, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: { name: 'asc' },
        take: limit,
        select: { ...companyTariffSelect, slug: true, _count: { select: { profiles: true } } },
      });

      const fallback = (
        await fastify.prisma.billingSettings.findUnique({
          where: { id: 'default' },
        })
      )?.agencyProfileLimit;

      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        profileCount: row._count.profiles,
        tariffName: tariffOf(row)?.name ?? null,
        effectiveLimit: effectiveProfileLimit(
          row.tariffTier,
          row.customProfileLimit,
          fallback ?? 8,
        ),
      }));
    },
  );

  fastify.get(
    '/admin/companies/:id/tariff',
    {
      onRequest: guard,
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

      const profileCount = await fastify.prisma.profile.count({
        where: { companyId: row.id },
      });
      return presentCompanyTariffState(fastify.prisma, row, profileCount);
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
};
