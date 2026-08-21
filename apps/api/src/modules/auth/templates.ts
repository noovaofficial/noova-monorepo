import type { Locale } from '@noova/shared';

/**
 * Тексты писем. Живут в коде, а не в словарях фронта: письма отправляет
 * бэкенд, и тянуть ради них весь i18n-слой незачем.
 *
 * Только текст, без HTML. Транзакционное письмо из двух строк не выигрывает
 * от вёрстки, а простой текст не попадает в спам из-за битой разметки
 * и одинаково читается в любом клиенте.
 */
type Template = { subject: string; body: (link: string) => string };

const VERIFY: Record<Locale, Template> = {
  de: {
    subject: 'Noova — E-Mail-Adresse bestätigen',
    body: (link) =>
      `Bitte bestätigen Sie Ihre E-Mail-Adresse:\n\n${link}\n\n` +
      'Der Link ist 24 Stunden gültig. Falls Sie sich nicht registriert haben, ' +
      'ignorieren Sie diese Nachricht.',
  },
  en: {
    subject: 'Noova — confirm your email address',
    body: (link) =>
      `Please confirm your email address:\n\n${link}\n\n` +
      'The link is valid for 24 hours. If you did not sign up, ignore this message.',
  },
  ru: {
    subject: 'Noova — подтверждение адреса',
    body: (link) =>
      `Подтвердите адрес электронной почты:\n\n${link}\n\n` +
      'Ссылка действует 24 часа. Если вы не регистрировались, просто удалите это письмо.',
  },
};

const RESET: Record<Locale, Template> = {
  de: {
    subject: 'Noova — Passwort zurücksetzen',
    body: (link) =>
      `Zum Zurücksetzen Ihres Passworts:\n\n${link}\n\n` +
      'Der Link ist eine Stunde gültig. Falls Sie das nicht angefordert haben, ' +
      'ignorieren Sie diese Nachricht — Ihr Passwort bleibt unverändert.',
  },
  en: {
    subject: 'Noova — reset your password',
    body: (link) =>
      `To reset your password:\n\n${link}\n\n` +
      'The link is valid for one hour. If you did not request this, ignore this message — ' +
      'your password stays unchanged.',
  },
  ru: {
    subject: 'Noova — сброс пароля',
    body: (link) =>
      `Чтобы задать новый пароль:\n\n${link}\n\n` +
      'Ссылка действует час. Если вы не запрашивали сброс, просто удалите это письмо — ' +
      'пароль останется прежним.',
  },
};

/**
 * Письмо на попытку регистрации на занятый адрес. Существует потому, что
 * форма регистрации намеренно не говорит «такой email уже есть»: настоящий
 * владелец адреса должен узнать о попытке, а посторонний — нет.
 */
const TAKEN: Record<Locale, { subject: string; body: string }> = {
  de: {
    subject: 'Noova — Registrierungsversuch',
    body:
      'Auf diese Adresse ist bereits ein Konto registriert. ' +
      'Falls Sie das waren, melden Sie sich einfach an oder setzen Sie Ihr Passwort zurück.',
  },
  en: {
    subject: 'Noova — sign-up attempt',
    body:
      'An account is already registered with this address. ' +
      'If this was you, simply log in or reset your password.',
  },
  ru: {
    subject: 'Noova — попытка регистрации',
    body:
      'На этот адрес уже зарегистрирована учётная запись. ' +
      'Если это были вы — просто войдите или восстановите пароль.',
  },
};

export function verifyEmailMail(locale: Locale, link: string) {
  const template = VERIFY[locale];
  return { subject: template.subject, text: template.body(link) };
}

export function resetPasswordMail(locale: Locale, link: string) {
  const template = RESET[locale];
  return { subject: template.subject, text: template.body(link) };
}

export function emailTakenMail(locale: Locale) {
  return { subject: TAKEN[locale].subject, text: TAKEN[locale].body };
}
