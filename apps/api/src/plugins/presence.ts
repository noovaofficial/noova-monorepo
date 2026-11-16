import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ONLINE_WINDOW_MS } from '../mappers.js';
import { PROFILES_TAG, profileTag } from './revalidate.js';

/**
 * Отметка «был активен». Раньше `lastSeenAt` писал только сид, поэтому бейдж
 * «Онлайн» гас через десять минут после сева и больше не появлялся, а фильтр
 * «онлайн сейчас» всегда возвращал пустоту.
 *
 * Активность владельца — это любой его запрос к своему кабинету. Писать в БД
 * на каждый запрос нельзя: это лишняя запись на каждое движение мышью,
 * поэтому отметка throttled через Redis.
 *
 * Отметки в базе мало: каталог и страница анкеты отдаются из кэша фронта, и
 * значок «Онлайн» появлялся бы на них только после чьей-то правки анкеты.
 * Поэтому смену состояния сообщаем фронту сами:
 *  - владелец пришёл (был не в сети) — сбрасываем кэш сразу;
 *  - владелец ушёл — по таймеру, когда с последней отметки прошло окно
 *    «онлайн» и новой не было.
 */
const TOUCH_INTERVAL_SECONDS = 120;
/** Сброс кэша каталога не чаще этого: приходят и уходят многие. */
const REVALIDATE_MIN_INTERVAL_MS = 20_000;

const presencePlugin: FastifyPluginAsync = async (fastify) => {
  /** Таймеры «ушёл из сети» по владельцам. Живут в памяти процесса. */
  const leaving = new Map<string, NodeJS.Timeout>();

  // Сброс с накоплением: первый — сразу, остальные за интервал — одним разом
  // в его конце. Иначе каждый вход рекламодателя сбрасывал бы кэш каталога.
  const pending = new Set<string>();
  let cooling: NodeJS.Timeout | null = null;
  function flush() {
    if (pending.size === 0) return;
    const tags = [...pending];
    pending.clear();
    fastify.revalidate(tags);
    cooling = setTimeout(() => {
      cooling = null;
      flush();
    }, REVALIDATE_MIN_INTERVAL_MS);
    cooling.unref();
  }
  function revalidateSoon(slugs: string[]) {
    if (slugs.length === 0) return;
    pending.add(PROFILES_TAG);
    for (const slug of slugs) pending.add(profileTag(slug));
    if (!cooling) flush();
  }

  const publishedSlugs = async (ownerId: string) =>
    (
      await fastify.prisma.profile.findMany({
        where: { ownerId, status: 'published' },
        select: { slug: true },
      })
    ).map((row) => row.slug);

  function scheduleLeave(userId: string) {
    const previous = leaving.get(userId);
    if (previous) clearTimeout(previous);
    // Чуть позже окна: к моменту пересборки страницы API уже должен
    // отвечать «не в сети».
    const timer = setTimeout(() => {
      leaving.delete(userId);
      publishedSlugs(userId)
        .then(revalidateSoon)
        .catch((error) => fastify.log.warn({ err: error }, 'не удалось снять отметку онлайн'));
    }, ONLINE_WINDOW_MS + 5_000);
    timer.unref();
    leaving.set(userId, timer);
  }

  fastify.addHook('onResponse', async (request) => {
    const session = request.session;
    if (session?.role !== 'advertiser') return;

    const key = `seen:${session.userId}`;
    try {
      // NX + EX: ключ ставится только если его не было, и сам протухает.
      // Пока он жив, в БД не пишем.
      const acquired = await fastify.redis.set(key, '1', 'EX', TOUCH_INTERVAL_SECONDS, 'NX');
      if (acquired !== 'OK') return;

      const now = new Date();
      // Кто был не в сети до этой отметки — у тех значок сейчас появится.
      const wentOnline = await fastify.prisma.profile.findMany({
        where: {
          ownerId: session.userId,
          status: 'published',
          OR: [
            { lastSeenAt: null },
            { lastSeenAt: { lt: new Date(now.getTime() - ONLINE_WINDOW_MS) } },
          ],
        },
        select: { slug: true },
      });
      await fastify.prisma.profile.updateMany({
        where: { ownerId: session.userId, status: 'published' },
        data: { lastSeenAt: now },
      });
      revalidateSoon(wentOnline.map((row) => row.slug));
      scheduleLeave(session.userId);
    } catch (error) {
      // Отметка присутствия не стоит того, чтобы ронять ответ.
      fastify.log.warn({ err: error }, 'не удалось отметить активность');
    }
  });

  fastify.addHook('onClose', async () => {
    for (const timer of leaving.values()) clearTimeout(timer);
    if (cooling) clearTimeout(cooling);
  });
};

export default fp(presencePlugin, {
  name: 'presence',
  dependencies: ['redis', 'session', 'revalidate'],
});
