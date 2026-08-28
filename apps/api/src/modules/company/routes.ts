/**
 * Компания в кабинете: агентство и салон заводят и правят свои данные (N-33).
 *
 * Одна компания на учётную запись — `Company.ownerId` уникален. Поэтому здесь
 * нет ни списка, ни идентификатора в пути: у обратившегося она либо есть,
 * либо нет, и создание с обновлением — это одна операция.
 *
 * Индивидуалке компания не положена: она размещает одну анкету от своего
 * имени, и посредника между ней и площадкой нет — на этом стоит правовая
 * позиция само-размещения (L-04).
 */
import { type CompanyInput, companyInputSchema, companySchema } from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSession } from '../../plugins/session.js';

const companySelect = {
  id: true,
  slug: true,
  kind: true,
  name: true,
  description: true,
  languages: true,
  payments: true,
  isActive: true,
  contacts: { orderBy: { position: 'asc' as const }, select: { type: true, value: true } },
  _count: { select: { profiles: true } },
};

type CompanyRow = {
  id: string;
  slug: string;
  kind: 'agency';
  name: string;
  description: string | null;
  isActive: boolean;
  contacts: { type: string; value: string }[];
  languages: string[];
  payments: ('cash' | 'card' | 'transfer')[];
  _count: { profiles: number };
};

const present = (row: CompanyRow) => ({
  id: row.id,
  slug: row.slug,
  kind: row.kind,
  name: row.name,
  description: row.description,
  isActive: row.isActive,
  contacts: row.contacts as { type: CompanyInput['contacts'][number]['type']; value: string }[],
  languages: row.languages,
  payments: row.payments,
  profileCount: row._count.profiles,
});

/**
 * Компания есть только у агентства. Проверяем тип рекламодателя,
 * а не наличие записи: без этого индивидуалка завела бы себе компанию и
 * получила бы возможность вести чужие анкеты.
 */
async function companyOwnerOr403(fastify: FastifyInstance, userId: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, advertiserKind: true },
  });
  if (!user || user.role !== 'advertiser') {
    throw fastify.httpErrors.forbidden('Доступно только рекламодателям');
  }
  // Салон — это анкета, а не компания рядом с ней (N-34): у него нет и не
  // должно быть отдельной записи компании.
  if (user.advertiserKind !== 'agency') {
    throw fastify.httpErrors.forbidden('Компания есть только у агентства');
  }
  return user.advertiserKind;
}

export const companyRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/me/company',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['account'], response: { 200: companySchema.nullable() } },
    },
    async (request) => {
      const { userId } = requireSession(request);
      await companyOwnerOr403(fastify, userId);

      const row = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: companySelect,
      });
      // null, а не 404: «компании ещё нет» — это нормальное состояние сразу
      // после регистрации, а не ошибка обращения.
      return row ? present(row as CompanyRow) : null;
    },
  );

  fastify.put(
    '/me/company',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['account'], body: companyInputSchema, response: { 200: companySchema } },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const advertiserKind = await companyOwnerOr403(fastify, userId);

      const { slug, kind, name, description, contacts, languages, payments, isActive } =
        request.body;

      if (kind !== advertiserKind) {
        throw fastify.httpErrors.badRequest(
          `Тип компании должен совпадать с типом учётной записи (${advertiserKind})`,
        );
      }

      const clash = await fastify.prisma.company.findUnique({
        where: { slug },
        select: { ownerId: true },
      });
      if (clash && clash.ownerId !== userId) {
        throw fastify.httpErrors.conflict('Этот адрес уже занят другой компанией');
      }

      const fields = {
        slug,
        kind,
        name,
        description: description ?? null,
        languages,
        payments,
        isActive,
      };

      const saved = await fastify.prisma.company.upsert({
        where: { ownerId: userId },
        create: {
          ...fields,
          ownerId: userId,
          contacts: { create: contacts.map((c, position) => ({ ...c, position })) },
        },
        update: {
          ...fields,
          // Переписываем целиком: порядок значим, а точечное обновление
          // оставило бы контакты, удалённые в форме.
          contacts: {
            deleteMany: {},
            create: contacts.map((c, position) => ({ ...c, position })),
          },
        },
        select: companySelect,
      });

      return present(saved as CompanyRow);
    },
  );

  /**
   * Привязка анкеты к компании. Отдельным маршрутом, а не полем в анкете:
   * это решение о принадлежности, и оно должно быть видно в журнале как
   * отдельное действие.
   */
  fastify.put(
    '/me/profiles/:id/company',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        body: z.object({ attached: z.boolean() }),
        response: { 200: z.object({ attached: z.boolean() }) },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      await companyOwnerOr403(fastify, userId);

      const company = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: { id: true },
      });
      if (!company) throw fastify.httpErrors.badRequest('Сначала заполните данные компании');

      // Чужую анкету привязать нельзя: проверяем владельца, а не только id.
      const profile = await fastify.prisma.profile.findFirst({
        where: { id: request.params.id, ownerId: userId },
        select: { id: true },
      });
      if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');

      await fastify.prisma.profile.update({
        where: { id: profile.id },
        data: { companyId: request.body.attached ? company.id : null },
      });

      return { attached: request.body.attached };
    },
  );
};
