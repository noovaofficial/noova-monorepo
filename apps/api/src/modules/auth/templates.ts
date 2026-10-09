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
export type Copy = {
  subject: string;
  heading: string;
  intro: string;
  /** Пронумерованные шаги — сейчас только у welcome-письма. */
  steps?: string[];
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
  es: {
    subject: 'Noova — confirma tu dirección de correo',
    heading: 'Bienvenido a Noova',
    intro: 'Confirma tu dirección de correo electrónico para completar el registro.',
    button: 'Confirmar la dirección',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'El enlace es válido durante 24 horas. Si no te has registrado, ignora este mensaje.',
  },
  fr: {
    subject: 'Noova — confirmez votre adresse e-mail',
    heading: 'Bienvenue sur Noova',
    intro: 'Confirmez votre adresse e-mail pour terminer votre inscription.',
    button: "Confirmer l'adresse",
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: 'Le lien est valable 24 heures. Si vous ne vous êtes pas inscrit, ignorez ce message.',
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
  es: {
    subject: 'Noova — restablecer la contraseña',
    heading: 'Nueva contraseña',
    intro: 'Has solicitado una nueva contraseña para tu cuenta de Noova.',
    button: 'Restablecer la contraseña',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'El enlace es válido una hora. Si no lo has solicitado, ignora este mensaje: tu contraseña no cambiará.',
  },
  fr: {
    subject: 'Noova — réinitialiser le mot de passe',
    heading: 'Nouveau mot de passe',
    intro: 'Vous avez demandé un nouveau mot de passe pour votre compte Noova.',
    button: 'Réinitialiser le mot de passe',
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: "Le lien est valable une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe restera inchangé.",
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
  es: {
    subject: 'Noova — intento de registro',
    heading: 'La cuenta ya existe',
    intro: 'Ya hay una cuenta registrada con esta dirección.',
    fallback: '',
    note: 'Si has sido tú, simplemente inicia sesión o recupera la contraseña. Si no, no hace falta hacer nada.',
  },
  fr: {
    subject: "Noova — tentative d'inscription",
    heading: 'Le compte existe déjà',
    intro: 'Un compte est déjà enregistré avec cette adresse.',
    fallback: '',
    note: "S'il s'agit de vous, connectez-vous simplement ou réinitialisez votre mot de passe. Sinon, aucune action n'est nécessaire.",
  },
  ru: {
    subject: 'Noova — попытка регистрации',
    heading: 'Учётная запись уже есть',
    intro: 'На этот адрес уже зарегистрирована учётная запись.',
    fallback: '',
    note: 'Если это были вы — просто войдите или восстановите пароль. Если нет — делать ничего не нужно.',
  },
};

/**
 * Письма после подтверждения почты рекламодателем (клиентам не уходит —
 * им нечего публиковать). Без промокода: это не маркетинговая рассылка по
 * агентствам (см. documentation/marketing/agency-welcome-email.html), а
 * базовая инструкция «что дальше» для всех, кто регистрируется сам.
 *
 * Два разных набора шагов, а не один на всех: у агентства профиль компании
 * и анкета модели — разные сущности, и шаг «добавить анкету» у индивидуалки
 * просто не существует (профиль компании и анкета — одно и то же). Ссылка
 * на кнопку собирается вызывающей стороной — см. `welcomeMail`.
 */
const WELCOME_INDIVIDUAL: Record<Locale, Copy> = {
  de: {
    subject: 'Noova — so geht es los',
    heading: 'Du bist dabei. Bringen wir dein Profil online.',
    intro: 'Willkommen bei Noova. So geht es los:',
    steps: [
      'Profil vervollständigen',
      'Kurze Inhaltsprüfung durchlaufen',
      'Veröffentlichen und im Katalog live gehen',
    ],
    button: 'Profil vervollständigen',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Die Prüfung dauert meist nicht lange.',
  },
  en: {
    subject: "Noova — here's how to go live",
    heading: "You're in. Let's get your profile live.",
    intro: "Welcome to Noova. Here's how to go live:",
    steps: [
      'Complete your profile',
      'Pass a quick content review',
      'Publish it and go live in the catalogue',
    ],
    button: 'Complete my profile',
    fallback: 'If the button does not work, open this link:',
    note: "Review usually doesn't take long.",
  },
  es: {
    subject: 'Noova — así puedes publicar',
    heading: 'Ya estás dentro. Vamos a publicar tu perfil.',
    intro: 'Bienvenido a Noova. Así es como empezar:',
    steps: [
      'Completa tu perfil',
      'Pasa una breve revisión de contenido',
      'Publícalo y aparecerá en el catálogo',
    ],
    button: 'Completar mi perfil',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'La revisión normalmente no tarda mucho.',
  },
  fr: {
    subject: 'Noova — comment publier votre profil',
    heading: 'Vous y êtes. Passons à la publication de votre profil.',
    intro: 'Bienvenue sur Noova. Voici comment procéder :',
    steps: [
      'Complétez votre profil',
      'Passez une brève vérification du contenu',
      'Publiez-le et apparaissez dans le catalogue',
    ],
    button: 'Compléter mon profil',
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: 'La vérification ne prend généralement pas longtemps.',
  },
  ru: {
    subject: 'Noova — как опубликовать анкету',
    heading: 'Вы на платформе. Осталось опубликовать анкету.',
    intro: 'Добро пожаловать в Noova. Вот как начать:',
    steps: [
      'Заполните анкету',
      'Пройдите короткую проверку контента',
      'Опубликуйте анкету — и она появится в каталоге',
    ],
    button: 'Заполнить анкету',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'Проверка обычно занимает немного времени.',
  },
};

const WELCOME_AGENCY: Record<Locale, Copy> = {
  de: {
    subject: 'Noova — so geht es los',
    heading: 'Du bist dabei. Bringen wir deine Profile online.',
    intro: 'Willkommen bei Noova. So geht es los:',
    steps: [
      'Agenturprofil vervollständigen',
      'Profil deines ersten Models hinzufügen',
      'Kurze Inhaltsprüfung durchlaufen',
      'Veröffentlichen und im Katalog live gehen',
    ],
    button: 'Profil vervollständigen',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Die Prüfung dauert meist nicht lange.',
  },
  en: {
    subject: "Noova — here's how to go live",
    heading: "You're in. Let's get your profiles live.",
    intro: "Welcome to Noova. Here's how to go live:",
    steps: [
      'Complete your agency profile',
      "Add your first model's profile",
      'Pass a quick content review',
      'Publish it and go live in the catalogue',
    ],
    button: 'Complete my profile',
    fallback: 'If the button does not work, open this link:',
    note: "Review usually doesn't take long.",
  },
  es: {
    subject: 'Noova — así puedes publicar',
    heading: 'Ya estás dentro. Vamos a publicar tus perfiles.',
    intro: 'Bienvenido a Noova. Así es como empezar:',
    steps: [
      'Completa el perfil de tu agencia',
      'Añade el perfil de tu primera modelo',
      'Pasa una breve revisión de contenido',
      'Publícalo y aparecerá en el catálogo',
    ],
    button: 'Completar mi perfil',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'La revisión normalmente no tarda mucho.',
  },
  fr: {
    subject: 'Noova — comment publier vos profils',
    heading: 'Vous y êtes. Passons à la publication de vos profils.',
    intro: 'Bienvenue sur Noova. Voici comment procéder :',
    steps: [
      'Complétez le profil de votre agence',
      'Ajoutez le profil de votre première modèle',
      'Passez une brève vérification du contenu',
      'Publiez-le et apparaissez dans le catalogue',
    ],
    button: 'Compléter mon profil',
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: 'La vérification ne prend généralement pas longtemps.',
  },
  ru: {
    subject: 'Noova — как опубликовать анкеты',
    heading: 'Вы на платформе. Осталось опубликовать анкеты.',
    intro: 'Добро пожаловать в Noova. Вот как начать:',
    steps: [
      'Заполните профиль агентства',
      'Добавьте анкету первой девушки',
      'Пройдите короткую проверку контента',
      'Опубликуйте анкету — она появится в каталоге',
    ],
    button: 'Заполнить профиль',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'Проверка обычно занимает немного времени.',
  },
};

/** Текстовая версия. Ссылка отдельной строкой: почтовые клиенты делают
 *  кликабельным весь URL, только если он не вплетён в предложение. */
function plain(copy: Copy, link?: string): string {
  const parts = [copy.intro];
  if (copy.steps?.length) parts.push(copy.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'));
  if (link) parts.push(link);
  parts.push(copy.note);
  return parts.join('\n\n');
}

export function buildMail(copy: Copy, locale: Locale, link?: string) {
  const content: EmailContent = {
    heading: copy.heading,
    intro: copy.intro,
    steps: copy.steps,
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
  return buildMail(VERIFY[locale], locale, link);
}

export function resetPasswordMail(locale: Locale, link: string) {
  return buildMail(RESET[locale], locale, link);
}

export function emailTakenMail(locale: Locale) {
  return buildMail(TAKEN[locale], locale);
}

export function welcomeMail(locale: Locale, link: string, isAgency: boolean) {
  const copy = isAgency ? WELCOME_AGENCY[locale] : WELCOME_INDIVIDUAL[locale];
  return buildMail(copy, locale, link);
}
