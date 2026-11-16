import { DEFAULT_LOCALE, isLocale, type Locale } from '@noova/shared';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { requestLocale } from '../i18n.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Язык сайта, на котором сейчас человек, — для названий из справочников
     * (город, район) в ответах кабинета. Публичные маршруты каталога берут
     * язык из `?locale=` (см. `localeQuerySchema`): их ответы кэшируются по
     * адресу, и язык обязан быть его частью. Здесь кэша нет, и заголовок
     * избавляет от параметра в каждом запросе.
     */
    locale: Locale;
  }
}

/** Должен совпадать с `LOCALE_HEADER` во фронте (shared/api-locale.ts). */
export const LOCALE_HEADER = 'x-noova-locale';

const localePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('locale', DEFAULT_LOCALE);
  // Колбэк, а не async: обработчик запроса должен выполняться *внутри*
  // `run`, иначе хранилище до него не доедет.
  fastify.addHook('onRequest', (request, _reply, done) => {
    const value = request.headers[LOCALE_HEADER];
    if (typeof value === 'string' && isLocale(value)) request.locale = value;
    requestLocale.run(request.locale, done);
  });
};

export default fp(localePlugin, { name: 'locale' });
