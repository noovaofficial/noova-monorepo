// Вне контейнера переменные лежат в .env; в проде их передаёт compose,
// и dotenv тогда просто ничего не находит и не делает.
import 'dotenv/config';
import { booleanFromString } from '@noova/shared';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  /** Кука сессии. Secure включается только в проде: на localhost нет TLS. */
  SESSION_COOKIE: z.string().default('noova_session'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  /** Соль для хэширования IP в журналах. Обязательна в проде. */
  IP_HASH_SALT: z.string().default('dev-only-salt'),

  // ---------- Почта ----------
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: booleanFromString(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('Noova <noreply@localhost>'),
  /** Публичный адрес фронта — из него собираются ссылки в письмах. */
  PUBLIC_SITE_URL: z.string().default('http://localhost:3000'),

  /**
   * Публичный адрес самого API. Из него собираются ссылки на неодобренные
   * фотографии: они отдаются не из хранилища, а этим сервисом, с проверкой
   * прав на каждый запрос. В проде совпадает с адресом сайта — Caddy разводит
   * их по путям; локально порт другой.
   */
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),

  /** Куда стучаться за сбросом кэша фронта. Пустое значение отключает сброс. */
  WEB_REVALIDATE_URL: z.string().default('http://localhost:3000/api/revalidate'),
  REVALIDATE_SECRET: z.string().default(''),

  /** Разрешённые Origin фронта, через запятую. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  /** Публичный префикс, из которого собираются URL картинок. */
  MEDIA_BASE_URL: z.string().default('http://localhost:9000/noova-media'),

  // Объектное хранилище. Совместимо с S3, локально это MinIO.
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('noova-media'),
  S3_ACCESS_KEY: z.string().default('noova'),
  S3_SECRET_KEY: z.string().default('noova-dev-secret'),

  /**
   * Общий секрет для запросов от фронта к API «изнутри» — серверного рендера.
   * Такие запросы идут с одного адреса (в проде это контейнер `web`), и без
   * освобождения весь рендер сайта упирается в лимит одного посетителя.
   * Пустое значение отключает освобождение: в дев-режиме это допустимо,
   * в проде — обязательный секрет.
   */
  INTERNAL_API_TOKEN: z.string().default(''),

  // ---------- Фоновые задачи (N-18) ----------
  /**
   * Сроки хранения в днях. В конфигурации, а не в коде: это обязательства
   * перед регулятором, и менять их приходится по юридическому решению,
   * а не выкатывая новую версию приложения.
   */
  JOBS_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(6 * 60 * 60),
  RETENTION_DELETED_PHOTOS_DAYS: z.coerce.number().int().min(1).default(30),
  RETENTION_AUTH_TOKENS_DAYS: z.coerce.number().int().min(1).default(7),
  RETENTION_CONTACT_REVEALS_DAYS: z.coerce.number().int().min(1).default(365),
  RETENTION_MODERATION_ACTIONS_DAYS: z.coerce.number().int().min(1).default(365),
  /** Снимки документов после решения по заявке. Данные особой категории:
   *  срок короткий, спор о решении за это время успевают поднять. */
  RETENTION_VERIFICATION_DOCS_DAYS: z.coerce.number().int().min(1).default(30),

  /**
   * Пейвол (payments.md, этап 3): публикация анкеты требует оплаченного
   * размещения. Включён по умолчанию — так локальная среда ведёт себя как
   * прод. `false` нужен ровно в одном окне: между выкладкой кода и запуском
   * grant-launch-listings, выдающего текущим рекламодателям стартовый год
   * (D-05), — и для проверки кабинета без оплаты.
   */
  PAYWALL_ENABLED: booleanFromString(true),
  /**
   * Льготные дни после истечения размещения (D-04): анкеты ещё в выдаче,
   * человек успевает оплатить. Конфигурация, а не константа: срок платежа
   * зависит от способа оплаты.
   */
  LISTING_GRACE_DAYS: z.coerce.number().int().min(0).default(3),
  /** За сколько дней до конца срока напоминать письмом. */
  LISTING_REMINDER_DAYS: z.coerce.number().int().min(1).default(3),

  /**
   * Paymento — приём криптовалюты (payments.md, этап 4, D-08). Пустой ключ
   * означает «касса не настроена»: создание пополнения отвечает 503, а
   * колбэки отклоняются — подпись без секрета проверить нечем.
   */
  PAYMENTO_API_KEY: z.string().default(''),
  PAYMENTO_SECRET_KEY: z.string().default(''),
  PAYMENTO_API_URL: z.string().default('https://api.paymento.io/v1'),
  PAYMENTO_GATEWAY_URL: z.string().default('https://app.paymento.io/gateway'),
  /**
   * Откуда строить адрес возврата с кассы. Paymento принимает только HTTPS,
   * а локальный сайт живёт на http://localhost — сюда подставляется адрес
   * туннеля (cloudflared, ngrok). Пусто — берётся PUBLIC_SITE_URL.
   */
  PAYMENTO_RETURN_BASE_URL: z.string().default(''),
  /**
   * Отсрочка перед физическим удалением учётной записи. Анкеты уходят из
   * каталога сразу, а данные стираются по истечении срока: удаление
   * необратимо, и угнанной сессией иначе стирают чужой заработок.
   */
  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().min(0).default(14),

  RATE_LIMIT_MAX: z.coerce.number().int().default(120),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Падаем до старта сервера: неверная конфигурация не должна доезжать до рантайма.
  console.error('Некорректные переменные окружения:');
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env: Env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
