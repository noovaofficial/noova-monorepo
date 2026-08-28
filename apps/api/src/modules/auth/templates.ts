import type { Locale } from '@noova/shared';
import { type EmailContent, renderEmail } from './email-layout.js';

/**
 * Тексты писем. Живут в коде, а не в словарях фронта: письма отправляет
 * бэкенд, и тянуть ради них весь i18n-слой незачем.
 *
 * Каждое письмо уходит в двух видах — текстом и версткой. Текстовая часть
 * не декоративная: почтовые фильтры считают письмо без неё подозрительным,
 * а часть получателей читает почту в клиентах, которые HTML не показывают.
 * Поэтому текст остаётся полноценным письмом, а не подписью «смотрите
 * картинку».
 */
type Copy = {
  subject: string;
  heading: string;
  intro: string;
  /** Надпись на кнопке. Нет — письмо без действия. */
  button?: string;
  fallback: string;
  note: string;
};

const VERIFY: Record<Locale, Copy> = {
  de: {
    subject: 'Noova — E-Mail-Adresse bestätigen',
    heading: 'Willkommen bei Noova',
    intro: 'Bitte bestätigen Sie Ihre E-Mail-Adresse, um die Registrierung abzuschließen.',
    button: 'E-Mail-Adresse bestätigen',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Der Link ist 24 Stunden gültig. Falls Sie sich nicht registriert haben, ignorieren Sie diese Nachricht.',
  },
  en: {
    subject: 'Noova — confirm your email address',
    heading: 'Welcome to Noova',
    intro: 'Please confirm your email address to finish signing up.',
    button: 'Confirm email address',
    fallback: 'If the button does not work, open this link:',
    note: 'The link is valid for 24 hours. If you did not sign up, ignore this message.',
  },
  ru: {
    subject: 'Noova — подтверждение адреса',
    heading: 'Добро пожаловать в Noova',
    intro: 'Подтвердите адрес электронной почты, чтобы завершить регистрацию.',
    button: 'Подтвердить адрес',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'Ссылка действует 24 часа. Если вы не регистрировались, просто удалите это письмо.',
  },
};

const RESET: Record<Locale, Copy> = {
  de: {
    subject: 'Noova — Passwort zurücksetzen',
    heading: 'Neues Passwort festlegen',
    intro: 'Sie haben ein neues Passwort für Ihr Noova-Konto angefordert.',
    button: 'Passwort zurücksetzen',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Der Link ist eine Stunde gültig. Falls Sie das nicht angefordert haben, ignorieren Sie diese Nachricht — Ihr Passwort bleibt unverändert.',
  },
  en: {
    subject: 'Noova — reset your password',
    heading: 'Set a new password',
    intro: 'You asked to set a new password for your Noova account.',
    button: 'Reset password',
    fallback: 'If the button does not work, open this link:',
    note: 'The link is valid for one hour. If you did not request this, ignore this message — your password stays unchanged.',
  },
  ru: {
    subject: 'Noova — сброс пароля',
    heading: 'Новый пароль',
    intro: 'Вы запросили новый пароль для учётной записи Noova.',
    button: 'Задать новый пароль',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'Ссылка действует час. Если вы не запрашивали сброс, просто удалите это письмо — пароль останется прежним.',
  },
};

/**
 * Письмо на попытку регистрации на занятый адрес. Существует потому, что
 * форма регистрации намеренно не говорит «такой email уже есть»: настоящий
 * владелец адреса должен узнать о попытке, а посторонний — нет.
 *
 * Кнопки здесь нет намеренно. Письмо приходит тому, кто ничего не делал,
 * и звать его перейти по ссылке — приучать к переходам из непрошеных писем.
 */
const TAKEN: Record<Locale, Copy> = {
  de: {
    subject: 'Noova — Registrierungsversuch',
    heading: 'Konto besteht bereits',
    intro: 'Auf diese Adresse ist bereits ein Konto registriert.',
    fallback: '',
    note: 'Falls Sie das waren, melden Sie sich einfach an oder setzen Sie Ihr Passwort zurück. Andernfalls ist nichts zu tun.',
  },
  en: {
    subject: 'Noova — sign-up attempt',
    heading: 'Account already exists',
    intro: 'An account is already registered with this address.',
    fallback: '',
    note: 'If this was you, simply log in or reset your password. Otherwise, no action is needed.',
  },
  ru: {
    subject: 'Noova — попытка регистрации',
    heading: 'Учётная запись уже есть',
    intro: 'На этот адрес уже зарегистрирована учётная запись.',
    fallback: '',
    note: 'Если это были вы — просто войдите или восстановите пароль. Если нет — делать ничего не нужно.',
  },
};

/** Текстовая версия. Ссылка отдельной строкой: почтовые клиенты делают
 *  кликабельным весь URL, только если он не вплетён в предложение. */
function plain(copy: Copy, link?: string): string {
  const parts = [copy.intro];
  if (link) parts.push(link);
  parts.push(copy.note);
  return parts.join('\n\n');
}

function build(copy: Copy, locale: Locale, link?: string) {
  const content: EmailContent = {
    heading: copy.heading,
    intro: copy.intro,
    note: copy.note,
    ...(link && copy.button
      ? { action: { href: link, label: copy.button, fallback: copy.fallback } }
      : {}),
  };
  return {
    subject: copy.subject,
    text: plain(copy, link),
    html: renderEmail(locale, content),
  };
}

export function verifyEmailMail(locale: Locale, link: string) {
  return build(VERIFY[locale], locale, link);
}

export function resetPasswordMail(locale: Locale, link: string) {
  return build(RESET[locale], locale, link);
}

export function emailTakenMail(locale: Locale) {
  return build(TAKEN[locale], locale);
}
