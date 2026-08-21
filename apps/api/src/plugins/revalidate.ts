import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Просит фронт сбросить кэш по тегам. Не ждёт результата. */
    revalidate(tags: string[]): void;
  }
}

/** Общий тег всех листингов — должен совпадать с `PROFILES_TAG` во фронте. */
export const PROFILES_TAG = 'profiles';
export const profileTag = (slug: string) => `profile:${slug}`;

/**
 * Сброс кэша фронта по событию.
 *
 * Намеренно «выстрелил и забыл»: если фронт недоступен или отвечает ошибкой,
 * это не должно ронять сохранение анкеты. Владелец предпочтёт увидеть свои
 * правки с задержкой, чем получить 500 на кнопке «Сохранить». Неудача уходит
 * в лог — по нему видно, что кэш разъехался.
 */
const revalidatePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('revalidate', (tags: string[]) => {
    if (!env.REVALIDATE_SECRET || tags.length === 0) return;

    void fetch(env.WEB_REVALIDATE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-secret': env.REVALIDATE_SECRET,
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(3000),
    })
      .then((response) => {
        if (!response.ok) {
          fastify.log.warn({ status: response.status, tags }, 'сброс кэша отклонён фронтом');
        }
      })
      .catch((error) => {
        fastify.log.warn({ err: error, tags }, 'не удалось сбросить кэш фронта');
      });
  });
};

export default fp(revalidatePlugin, { name: 'revalidate' });
