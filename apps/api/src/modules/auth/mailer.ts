import { DEFAULT_LOCALE, isLocale, type Locale } from '@noova/shared';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction } from '../../env.js';

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Отправка по SMTP. В разработке это Mailpit из docker-compose.dev.yml,
 * в проде — собственный Postfix: массовые почтовые сервисы ограничивают
 * adult в пользовательских соглашениях, а блокировка аккаунта остановила бы
 * регистрацию и сброс пароля, то есть вход на сайт.
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly log: FastifyBaseLogger) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
      // Соединение переиспользуется: на каждое письмо новый TLS-хендшейк
      // с собственным сервером — лишняя секунда и лишний повод для сбоя.
      pool: true,
      maxConnections: 3,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
    // Тело письма не логируем никогда: в нём одноразовая ссылка.
    this.log.info({ to: mail.to, subject: mail.subject }, 'письмо отправлено');
  }

  close(): void {
    this.transporter.close();
  }
}

/**
 * Заглушка для случая, когда SMTP не настроен. Пишет в лог **без тела**:
 * раньше сюда попадали одноразовые токены, и журналы превращались в связку
 * ключей от всех учётных записей.
 */
export class LogMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  async send(mail: Mail): Promise<void> {
    this.log.warn({ to: mail.to, subject: mail.subject }, 'ПИСЬМО НЕ ОТПРАВЛЕНО: SMTP не настроен');
  }
}

export function createMailer(log: FastifyBaseLogger): Mailer {
  if (!env.SMTP_HOST) {
    if (isProduction) throw new Error('SMTP_HOST обязателен в проде');
    return new LogMailer(log);
  }
  return new SmtpMailer(log);
}

/** Ссылка в письме собирается из публичного адреса фронта, а не из заголовков запроса. */
export function mailLink(locale: Locale, path: string, token: string): string {
  const base = env.PUBLIC_SITE_URL.replace(/\/$/, '');
  return `${base}/${locale}${path}?token=${encodeURIComponent(token)}`;
}

export function localeOf(value: string | null | undefined): Locale {
  return isLocale(value ?? '') ? (value as Locale) : DEFAULT_LOCALE;
}
