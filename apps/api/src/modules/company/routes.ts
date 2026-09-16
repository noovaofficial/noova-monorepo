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

import { randomUUID } from 'node:crypto';
import {
  agencyTariffUpgradeInputSchema,
  type CompanyInput,
  companyInputSchema,
  companySchema,
  companyTariffStateSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PROFILES_TAG } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import {
  companyTariffSelect,
  computeAgencyUpgrade,
  fallbackAgencyProfileLimit,
  presentCompanyTariffState,
  resolveDefaultAgencyTierId,
  TariffTierNotFoundError,
  TariffUpgradeNotAllowedError,
} from '../billing/agency-tariffs.js';
import { applyMovement, InsufficientBalanceError } from '../billing/wallet.js';
import { ImageError } from '../photos/images.js';
import { deleteObject, PUBLIC_PREFIX, publicUrl, putObject } from '../photos/storage.js';
import { MAX_LOGO_BYTES, processLogo } from './logo.js';

const companySelect = {
  id: true,
  slug: true,
  kind: true,
  name: true,
  description: true,
  website: true,
  logoStorageKey: true,
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
  website: string | null;
  logoStorageKey: string | null;
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
  website: row.website,
  logoUrl: row.logoStorageKey ? publicUrl(row.logoStorageKey) : null,
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
  if (user?.role !== 'advertiser') {
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

      const { slug, kind, name, description, website, contacts, languages, payments, isActive } =
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
        website: website ?? null,
        languages,
        payments,
        isActive,
      };

      // Тариф назначается сразу при заведении компании, а не по факту первой
      // анкеты сверх лимита: без этого свежая компания на секунду висела бы
      // без тарифа, и первый же лимит-чек читал бы аварийный fallback.
      const defaultTariffTierId = await resolveDefaultAgencyTierId(fastify.prisma);

      const saved = await fastify.prisma.company.upsert({
        where: { ownerId: userId },
        create: {
          ...fields,
          ownerId: userId,
          tariffTierId: defaultTariffTierId,
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

      // Публичная страница компании кэшируется тем же тегом, что и остальные
      // листинги (см. PROFILES_TAG во фронте) — без сброса правки в кабинете
      // доезжали бы до витрины только по истечении ISR.
      fastify.revalidate([PROFILES_TAG]);
      return present(saved as CompanyRow);
    },
  );

  /**
   * Логотип агентства — не модерируется (это не фото человека, а элемент
   * фирменного стиля) и не имеет истории версий: загрузка заменяет прежний
   * файл, а не добавляет новый.
   */
  fastify.put(
    '/me/company/logo',
    {
      onRequest: fastify.requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: { tags: ['account'], response: { 200: z.object({ logoUrl: z.string() }) } },
    },
    async (request) => {
      const { userId } = requireSession(request);
      await companyOwnerOr403(fastify, userId);

      const company = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: { id: true, logoStorageKey: true },
      });
      if (!company) throw fastify.httpErrors.badRequest('Сначала заполните данные компании');

      const file = await request.file({ limits: { fileSize: MAX_LOGO_BYTES } });
      if (!file) throw fastify.httpErrors.badRequest('Файл не передан');
      const buffer = await file.toBuffer().catch(() => {
        throw fastify.httpErrors.badRequest('Файл больше допустимого размера');
      });

      let processed: Awaited<ReturnType<typeof processLogo>>;
      try {
        processed = await processLogo(buffer);
      } catch (error) {
        if (error instanceof ImageError) {
          throw fastify.httpErrors.badRequest(
            'Файл не является изображением поддерживаемого формата',
          );
        }
        throw error;
      }

      const key = `${PUBLIC_PREFIX}/company-logo/${company.id}/${randomUUID()}.webp`;
      await putObject(key, processed.buffer, 'image/webp');

      const previousKey = company.logoStorageKey;
      await fastify.prisma.company.update({
        where: { id: company.id },
        data: { logoStorageKey: key },
      });

      // Старый файл убираем уже после того, как база указывает на новый —
      // так сбой удаления не оставит компанию без рабочего логотипа.
      if (previousKey) {
        await deleteObject(previousKey).catch((error) => {
          request.log.warn({ err: error, key: previousKey }, 'не удалось удалить старый логотип');
        });
      }

      fastify.revalidate([PROFILES_TAG]);
      return { logoUrl: publicUrl(key) };
    },
  );

  fastify.delete(
    '/me/company/logo',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['account'], response: { 204: z.null() } },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      await companyOwnerOr403(fastify, userId);

      const company = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: { id: true, logoStorageKey: true },
      });
      if (!company) throw fastify.httpErrors.badRequest('Сначала заполните данные компании');

      if (company.logoStorageKey) {
        await deleteObject(company.logoStorageKey).catch((error) => {
          request.log.warn(
            { err: error, key: company.logoStorageKey },
            'не удалось удалить логотип',
          );
        });
        await fastify.prisma.company.update({
          where: { id: company.id },
          data: { logoStorageKey: null },
        });
        fastify.revalidate([PROFILES_TAG]);
      }

      return reply.status(204).send(null);
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

  // --- Тариф по числу анкет (payments.md §3.3, D-13) -----------------------

  fastify.get(
    '/me/company/tariff',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['account'], response: { 200: companyTariffStateSchema } },
    },
    async (request) => {
      const { userId } = requireSession(request);
      await companyOwnerOr403(fastify, userId);

      const company = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: companyTariffSelect,
      });
      const profileCount = await fastify.prisma.profile.count({ where: { ownerId: userId } });

      // Компании ещё нет — обычное состояние сразу после регистрации
      // агентства (до `PUT /me/company`), а не ошибка обращения: анкеты
      // можно заводить и без неё. Тарифа тоже пока нет — действует
      // аварийный fallback, а не отказ загрузки.
      if (!company) {
        return {
          companyId: '',
          companyName: '',
          hasCompany: false,
          profileCount,
          tariffTier: null,
          customProfileLimit: null,
          customPrices: { m1: null, m6: null, m12: null },
          effectiveLimit: await fallbackAgencyProfileLimit(fastify.prisma),
          // Апгрейд требует компанию (см. ниже) — без неё показывать тарифы
          // на выбор нечем: подсказка «заполните данные» уже ведёт куда надо.
          candidateTiers: [],
        };
      }

      return presentCompanyTariffState(fastify.prisma, company, profileCount);
    },
  );

  /**
   * Самостоятельный апгрейд из пейвола: доплата за остаток оплаченного
   * периода списывается сразу, без одобрения — это покупка, а не заявка.
   * Сбрасывает индивидуальный override: после апгрейда действует тариф из
   * сетки, а не прежняя ручная договорённость.
   */
  fastify.post(
    '/me/company/tariff/upgrade',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        body: agencyTariffUpgradeInputSchema,
        response: { 200: companyTariffStateSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      await companyOwnerOr403(fastify, userId);

      const company = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: companyTariffSelect,
      });
      if (!company) throw fastify.httpErrors.badRequest('Сначала заполните данные компании');

      try {
        const { targetTier, costGc } = await computeAgencyUpgrade(fastify.prisma, {
          company,
          ownerId: userId,
          input: request.body,
        });

        await fastify.prisma.$transaction(async (tx) => {
          await applyMovement(tx, { userId, kind: 'SPEND', gcAmount: -costGc });
          await tx.company.update({
            where: { id: company.id },
            data: {
              tariffTierId: targetTier.id,
              customProfileLimit: null,
              customPriceM1Gc: null,
              customPriceM6Gc: null,
              customPriceM12Gc: null,
            },
          });
        });

        const updated = await fastify.prisma.company.findUniqueOrThrow({
          where: { id: company.id },
          select: companyTariffSelect,
        });
        const profileCount = await fastify.prisma.profile.count({ where: { ownerId: userId } });
        return presentCompanyTariffState(fastify.prisma, updated, profileCount);
      } catch (error) {
        if (error instanceof TariffTierNotFoundError) {
          throw fastify.httpErrors.badRequest(error.message);
        }
        if (error instanceof TariffUpgradeNotAllowedError) {
          throw fastify.httpErrors.badRequest(error.message);
        }
        if (error instanceof InsufficientBalanceError) {
          throw fastify.httpErrors.conflict(
            `Недостаточно GlowCoin: на балансе ${error.balance}, нужно ${error.requested}`,
          );
        }
        throw error;
      }
    },
  );
};
