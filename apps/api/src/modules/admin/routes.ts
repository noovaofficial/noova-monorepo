import {
  ANALYTICS_PERIOD_DAYS,
  adminAdvertiserAnalyticsSchema,
  analyticsPeriodSchema,
  createStaffSchema,
  grantTopInputSchema,
  grantTopResultSchema,
  moderationLogEntrySchema,
  moderationLogQuerySchema,
  type moderationSubjectRefSchema,
  overviewQuerySchema,
  overviewSchema,
  pageSchema,
  staffMemberSchema,
  topNowSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { photoUrl } from '../../mappers.js';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { loadMoney } from '../analytics/admin-money.js';
import { loadOverview } from '../analytics/overview.js';
import { loadAnalytics } from '../analytics/query.js';
import { hashPassword } from '../auth/passwords.js';
import { loadBillingConfig } from '../billing/config.js';
import { grantTop, TopFullError, TopNotPublishedError } from '../billing/top.js';
import { toTransaction } from '../billing/wallet.js';
import { publicUrl } from '../photos/storage.js';
import { decodeCursor, encodeCursor } from '../profiles/query.js';

/**
 * Раскрывает предмет решения. Один запрос на тип, а не по строке на запись:
 * журнал отдаёт до двухсот записей, и обход в цикле дал бы двести запросов.
 *
 * Отсутствующий предмет не ошибка: фото могло быть вычищено по сроку хранения
 * (N-18), учётка — удалена. Такая запись вернётся без `subject`, и строка
 * покажется с пометкой «удалено».
 */
async function resolveSubjects(
  fastify: FastifyInstance,
  rows: { subjectType: string; subjectId: string }[],
): Promise<Map<string, z.infer<typeof moderationSubjectRefSchema>>> {
  const byType = new Map<string, string[]>();
  for (const row of rows) {
    byType.set(row.subjectType, [...(byType.get(row.subjectType) ?? []), row.subjectId]);
  }
  const found = new Map<string, z.infer<typeof moderationSubjectRefSchema>>();
  const key = (type: string, id: string) => `${type}:${id}`;

  const photoIds = byType.get('photo') ?? [];
  if (photoIds.length > 0) {
    const photos = await fastify.prisma.photo.findMany({
      where: { id: { in: photoIds } },
      select: {
        id: true,
        profile: {
          select: {
            id: true,
            displayName: true,
            city: { select: { name: true } },
            owner: { select: { email: true } },
          },
        },
      },
    });
    for (const photo of photos) {
      found.set(key('photo', photo.id), {
        title: photo.profile.displayName,
        accountEmail: photo.profile.owner.email,
        profileId: photo.profile.id,
        cityName: photo.profile.city.name,
      });
    }
  }

  const caseIds = byType.get('verification') ?? [];
  if (caseIds.length > 0) {
    const cases = await fastify.prisma.verificationCase.findMany({
      where: { id: { in: caseIds } },
      select: {
        id: true,
        profile: {
          select: {
            id: true,
            displayName: true,
            city: { select: { name: true } },
            owner: { select: { email: true } },
          },
        },
      },
    });
    for (const item of cases) {
      found.set(key('verification', item.id), {
        title: item.profile.displayName,
        accountEmail: item.profile.owner.email,
        profileId: item.profile.id,
        cityName: item.profile.city.name,
      });
    }
  }

  const commentIds = byType.get('comment') ?? [];
  if (commentIds.length > 0) {
    const comments = await fastify.prisma.profileComment.findMany({
      where: { id: { in: commentIds } },
      select: {
        id: true,
        body: true,
        author: { select: { email: true } },
        profile: { select: { id: true, displayName: true, city: { select: { name: true } } } },
      },
    });
    for (const comment of comments) {
      found.set(key('comment', comment.id), {
        // Начало текста, а не весь: в строке журнала нужен опознавательный
        // признак, а не содержимое отзыва.
        title: comment.body.slice(0, 60),
        // Учётка автора отзыва, а не владелицы: решение касалось его текста.
        accountEmail: comment.author.email,
        profileId: comment.profile.id,
        cityName: comment.profile.city.name,
      });
    }
  }

  // Решение по личности: показываем анкету, к которой относится заявка, —
  // сам идентификатор заявки в журнале ничего не говорит.
  const identityIds = byType.get('identity') ?? [];
  if (identityIds.length > 0) {
    const requests = await fastify.prisma.verificationRequest.findMany({
      where: { id: { in: identityIds } },
      select: {
        id: true,
        profile: {
          select: {
            id: true,
            displayName: true,
            city: { select: { name: true } },
            owner: { select: { email: true } },
          },
        },
      },
    });
    for (const item of requests) {
      found.set(key('identity', item.id), {
        title: item.profile.displayName,
        accountEmail: item.profile.owner.email,
        profileId: item.profile.id,
        cityName: item.profile.city.name,
      });
    }
  }

  const userIds = byType.get('user') ?? [];
  if (userIds.length > 0) {
    const users = await fastify.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    for (const user of users) {
      found.set(key('user', user.id), {
        title: user.email,
        accountEmail: user.email,
        profileId: null,
        cityName: null,
      });
    }
  }

  const companyIds = byType.get('company') ?? [];
  if (companyIds.length > 0) {
    const companies = await fastify.prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, owner: { select: { email: true } } },
    });
    for (const company of companies) {
      found.set(key('company', company.id), {
        title: company.name,
        accountEmail: company.owner.email,
        profileId: null,
        cityName: null,
      });
    }
  }

  const profileIds = byType.get('profile') ?? [];
  if (profileIds.length > 0) {
    const profiles = await fastify.prisma.profile.findMany({
      where: { id: { in: profileIds } },
      select: {
        id: true,
        displayName: true,
        city: { select: { name: true } },
        owner: { select: { email: true } },
      },
    });
    for (const profile of profiles) {
      found.set(key('profile', profile.id), {
        title: profile.displayName,
        accountEmail: profile.owner.email,
        profileId: profile.id,
        cityName: profile.city.name,
      });
    }
  }

  return found;
}

type StaffRow = {
  id: string;
  email: string;
  role: 'moderator' | 'admin';
  bannedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  _count: { moderationActions: number };
};

function toStaffMember(row: StaffRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    isBlocked: row.bannedAt !== null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    decisionCount: row._count.moderationActions,
  };
}

const staffSelect = {
  id: true,
  email: true,
  role: true,
  bannedAt: true,
  lastLoginAt: true,
  createdAt: true,
  _count: { select: { moderationActions: true } },
} as const;

export const adminRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const guard = fastify.requireRole('admin');

  fastify.get(
    '/admin/staff',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], response: { 200: z.array(staffMemberSchema) } },
    },
    async () => {
      const rows = await fastify.prisma.user.findMany({
        where: { role: { in: ['moderator', 'admin'] } },
        orderBy: { createdAt: 'asc' },
        select: staffSelect,
      });
      return rows.map((row) => toStaffMember(row as StaffRow));
    },
  );

  /**
   * Кто сейчас в ТОПе: активные и не истёкшие размещения анкет (включая
   * салоны) и агентств. Ближайшие к окончанию — первыми: их и надо замечать.
   */
  fastify.get(
    '/admin/top-now',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: { tags: ['admin'], response: { 200: topNowSchema } },
    },
    async () => {
      const now = new Date();
      const active = { status: 'active' as const, expiresAt: { gt: now } };

      const [placements, agencyPlacements] = await Promise.all([
        fastify.prisma.topPlacement.findMany({
          where: active,
          orderBy: { expiresAt: 'asc' },
          select: {
            startsAt: true,
            expiresAt: true,
            profile: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                city: { select: { name: true } },
                owner: { select: { advertiserKind: true } },
                company: { select: { name: true } },
                photos: {
                  where: { isApproved: true },
                  orderBy: { position: 'asc' },
                  take: 1,
                  select: { storageKey: true },
                },
              },
            },
          },
        }),
        fastify.prisma.agencyTopPlacement.findMany({
          where: active,
          orderBy: { expiresAt: 'asc' },
          select: {
            startsAt: true,
            expiresAt: true,
            company: {
              select: {
                id: true,
                slug: true,
                name: true,
                logoStorageKey: true,
                _count: { select: { profiles: { where: { status: 'published' } } } },
              },
            },
          },
        }),
      ]);

      return {
        profiles: placements.map((row) => ({
          profileId: row.profile.id,
          slug: row.profile.slug,
          displayName: row.profile.displayName,
          ownerKind: row.profile.owner.advertiserKind ?? 'individual',
          companyName: row.profile.company?.name ?? null,
          city: row.profile.city.name,
          coverUrl: row.profile.photos[0] ? photoUrl(row.profile.photos[0].storageKey) : null,
          startsAt: row.startsAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        })),
        agencies: agencyPlacements.map((row) => ({
          companyId: row.company.id,
          slug: row.company.slug,
          name: row.company.name,
          logoUrl: row.company.logoStorageKey ? publicUrl(row.company.logoStorageKey) : null,
          profileCount: row.company._count.profiles,
          startsAt: row.startsAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        })),
      };
    },
  );

  /**
   * Аналитика одного рекламодателя для админа: тот же отчёт по трафику, что
   * видит сам рекламодатель, плюс деньги (пополнения, коины, подарки, траты),
   * размещение и последние операции. Деньги — за выбранный период и за всё
   * время сразу: «за всё время» отдельным периодом трафик не имеет смысла.
   */
  fastify.get(
    '/admin/advertisers/:userId/analytics',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ userId: z.string().min(1) }),
        querystring: z.object({ period: analyticsPeriodSchema.default('d30') }),
        response: { 200: adminAdvertiserAnalyticsSchema },
      },
    },
    async (request) => {
      const { userId } = request.params;
      const { period } = request.query;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          advertiserKind: true,
          glowcoinBalance: true,
          company: { select: { name: true, tariffTier: { select: { name: true } } } },
        },
      });
      if (user?.role !== 'advertiser') {
        throw fastify.httpErrors.notFound('Рекламодатель не найден');
      }

      const profiles = await fastify.prisma.profile.findMany({
        where: { ownerId: userId },
        select: { id: true, displayName: true, slug: true },
        orderBy: { createdAt: 'asc' },
      });

      const since = new Date(Date.now() - ANALYTICS_PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);

      const [traffic, money, listing] = await Promise.all([
        loadAnalytics(fastify.prisma, { profiles, ownerId: userId }, period),
        loadMoney(fastify.prisma, userId, since),
        fastify.prisma.listing.findFirst({
          where: { userId },
          orderBy: { expiresAt: 'desc' },
          select: { status: true, term: true, expiresAt: true },
        }),
      ]);

      return {
        advertiser: {
          userId: user.id,
          email: user.email,
          advertiserKind: user.advertiserKind,
          name: user.company?.name ?? profiles[0]?.displayName ?? null,
        },
        balanceGc: user.glowcoinBalance,
        listing: listing
          ? {
              status: listing.status,
              term: listing.term,
              expiresAt: listing.expiresAt.toISOString(),
            }
          : null,
        tariffTier: user.company?.tariffTier?.name ?? null,
        traffic,
        money: { period: money.period, allTime: money.allTime },
        transactions: money.periodTx.slice(0, 100).map(toTransaction),
      };
    },
  );

  /**
   * Обзор рекламодателей для админа: кто самый ценный (по оплаченным €),
   * сводка по типам, динамика, таблица с сортировкой. События идут из
   * суточных агрегатов, результат кэшируется (см. `loadOverview`).
   */
  fastify.get(
    '/admin/overview',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        querystring: overviewQuerySchema,
        response: { 200: overviewSchema },
      },
    },
    async (request) => loadOverview(fastify.prisma, request.query),
  );

  fastify.post(
    '/admin/staff',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        body: createStaffSchema,
        response: { 201: staffMemberSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);

      const existing = await fastify.prisma.user.findUnique({
        where: { email: request.body.email },
        select: { id: true },
      });
      // Здесь занятый адрес показываем прямо: это закрытый раздел для
      // администратора, скрывать от него состояние системы незачем.
      if (existing) throw fastify.httpErrors.conflict('Пользователь с таким адресом уже есть');

      const created = await fastify.prisma.user.create({
        data: {
          email: request.body.email,
          passwordHash: await hashPassword(request.body.password),
          role: request.body.role,
          // Сотрудника создаёт админ, значит адрес считается подтверждённым:
          // письмо слать некуда, почта ещё не подключена (N-15).
          emailVerifiedAt: new Date(),
          isAdult: true,
          createdById: userId,
        },
        select: staffSelect,
      });

      fastify.log.info(
        { actor: userId, created: created.id, role: request.body.role },
        'создана служебная учётная запись',
      );

      return reply.status(201).send(toStaffMember(created as StaffRow));
    },
  );

  fastify.post(
    '/admin/staff/:id/block',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        body: z.object({ blocked: z.boolean() }),
        response: { 200: staffMemberSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);

      // Заблокировать себя значит потерять доступ к разделу и не суметь
      // разблокироваться обратно.
      if (request.params.id === userId) {
        throw fastify.httpErrors.badRequest('Нельзя заблокировать собственную учётную запись');
      }

      const target = await fastify.prisma.user.findFirst({
        where: { id: request.params.id, role: { in: ['moderator', 'admin'] } },
        select: { id: true },
      });
      if (!target) throw fastify.httpErrors.notFound('Сотрудник не найден');

      const updated = await fastify.prisma.user.update({
        where: { id: target.id },
        data: { bannedAt: request.body.blocked ? new Date() : null },
        select: staffSelect,
      });

      // Блокировка должна действовать сразу, а не после истечения сессии.
      if (request.body.blocked) await fastify.destroyAllSessions(target.id);

      return toStaffMember(updated as StaffRow);
    },
  );

  /**
   * Удаление сотрудника — в отличие от блокировки, необратимо: учётка
   * пропадает, а не просто теряет доступ. Решения из журнала модерации не
   * трогает: `ModerationAction.moderatorId` допускает null именно ради
   * этого — запись о том, кто и что одобрил, остаётся доказательством и
   * без живого автора (см. схему).
   */
  fastify.delete(
    '/admin/staff/:id',
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
      const { userId } = requireSession(request);

      // Удалить себя значит остаться без единственного способа отменить это.
      if (request.params.id === userId) {
        throw fastify.httpErrors.badRequest('Нельзя удалить собственную учётную запись');
      }

      const target = await fastify.prisma.user.findFirst({
        where: { id: request.params.id, role: { in: ['moderator', 'admin'] } },
        select: { id: true, email: true },
      });
      if (!target) throw fastify.httpErrors.notFound('Сотрудник не найден');

      await fastify.destroyAllSessions(target.id);
      await fastify.prisma.user.delete({ where: { id: target.id } });

      fastify.log.info(
        { actor: userId, deleted: target.id, email: target.email },
        'удалена служебная учётная запись',
      );

      return reply.status(204).send(null);
    },
  );

  fastify.get(
    '/admin/moderation-log',
    {
      // Журнал доступен и модератору, но только на собственные решения:
      // он существует как надзор за сотрудниками, а не как их общая лента.
      // Ограничение ниже, по сессии, — параметр запроса тут не указ.
      onRequest: fastify.requireRole('moderator', 'admin'),
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        querystring: moderationLogQuerySchema,
        response: { 200: pageSchema(moderationLogEntrySchema) },
      },
    },
    async (request) => {
      const session = requireSession(request);
      // Модератору подменяем фильтр на него самого, что бы ни пришло в запросе.
      const moderatorId = session.role === 'admin' ? request.query.moderatorId : session.userId;

      const { limit } = request.query;
      const cursorId = decodeCursor(request.query.cursor);
      const where = {
        ...(moderatorId ? { moderatorId } : {}),
        ...(request.query.subjectType ? { subjectType: request.query.subjectType } : {}),
        ...(request.query.decision ? { decision: request.query.decision } : {}),
      };

      const fetched = await fastify.prisma.moderationAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: {
          id: true,
          subjectType: true,
          subjectId: true,
          decision: true,
          reason: true,
          createdAt: true,
          moderator: { select: { id: true, email: true } },
        },
      });

      const hasMore = fetched.length > limit;
      const rows = fetched.slice(0, limit);
      const subjects = await resolveSubjects(fastify, rows);

      const items = rows.map((row) => ({
        id: row.id,
        moderatorEmail: row.moderator?.email ?? null,
        moderatorId: row.moderator?.id ?? null,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        subject: subjects.get(`${row.subjectType}:${row.subjectId}`) ?? null,
        decision: row.decision,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      }));

      return {
        items,
        nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]?.id ?? '') : null,
        total: await fastify.prisma.moderationAction.count({ where }),
      };
    },
  );

  /**
   * Выдача ТОПа анкете без оплаты (payments.md §3.4, D-10) — тот же лимит
   * мест и те же проверки, что у покупки, только бесплатно. Только админ:
   * это обход оплаты, как и остальные денежные решения в этом файле.
   */
  fastify.post(
    '/admin/profiles/:id/top',
    {
      onRequest: guard,
      config: { rateLimit: false },
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.string().min(1) }),
        body: grantTopInputSchema,
        response: { 200: grantTopResultSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const config = await loadBillingConfig(fastify.prisma);

      try {
        const result = await grantTop(fastify.prisma, {
          profileId: request.params.id,
          slots: config.top.slots,
          durationDays: request.body.days,
        });

        await fastify.prisma.moderationAction.create({
          data: {
            moderatorId: userId,
            subjectType: 'profile',
            subjectId: request.params.id,
            decision: 'approved',
            reason: result.extended ? 'ТОП продлён администратором' : 'ТОП выдан администратором',
          },
        });

        const profile = await fastify.prisma.profile.findUnique({
          where: { id: request.params.id },
          select: { slug: true },
        });
        if (profile) fastify.revalidate([PROFILES_TAG, profileTag(profile.slug)]);

        return { placement: result.placement };
      } catch (error) {
        if (error instanceof TopFullError) {
          throw fastify.httpErrors.conflict(`Все ${error.slots} мест в ТОПе заняты`);
        }
        if (error instanceof TopNotPublishedError) {
          throw fastify.httpErrors.conflict(error.message);
        }
        throw error;
      }
    },
  );
};
