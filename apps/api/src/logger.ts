import type { LoggerOptions } from 'pino';
import { env, isProduction } from './env.js';

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  // В проде — чистый JSON для сборщика логов; локально — читаемый вывод.
  transport: isProduction
    ? undefined
    : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.passwordHash',
      'token',
      '*.token',
      '*.tokenHash',
      // Тело письма содержит одноразовую ссылку — в журнал попадать не должно.
      // Вёрстка несёт ту же ссылку дважды: в кнопке и в запасной строке.
      'text',
      '*.text',
      'mail.text',
      'html',
      '*.html',
      'mail.html',
    ],
    remove: true,
  },
};
