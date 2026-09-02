import {
  createStaffSchema,
  moderationLogEntrySchema,
  moderationLogQuerySchema,
  type moderationSubjectRefSchema,
  pageSchema,
  staffMemberSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireSession } from '../../plugins/session.js';
import { hashPassword } from '../auth/passwords.js';
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

  fastify.post(
    '/admin/staff',
    {
      onRequest: guard,
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

  fastify.get(
    '/admin/moderation-log',
    {
      // Журнал доступен и модератору, но только на собственные решения:
      // он существует как надзор за сотрудниками, а не как их общая лента.
      // Ограничение ниже, по сессии, — параметр запроса тут не указ.
      onRequest: fastify.requireRole('moderator', 'admin'),
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
        moderatorEmail: row.moderator.email,
        moderatorId: row.moderator.id,
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
};
