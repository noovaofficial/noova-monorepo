import type { Locale } from '@noova/shared';
import { env } from '../../env.js';
import { buildMail, type Copy } from '../auth/templates.js';

/**
 * Письма о сроке размещения (payments.md, этап 5). Три момента: за несколько
 * дней до конца, в день истечения с датой конца льготных дней и в день
 * снятия анкет. Без письма истечение выглядит как поломка сайта.
 *
 * Язык — язык учётной записи (`User.locale`), тот же, что у писем входа.
 */

const subscriptionLink = (locale: Locale): string =>
  `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/${locale}/account/subscription`;

/** Дата по правилам языка получателя; часовой пояс — рынка, а не сервера. */
const formatDate = (locale: Locale, date: Date): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Europe/Berlin' }).format(date);

const REMINDER: Record<Locale, (date: string) => Copy> = {
  de: (date) => ({
    subject: `Noova — Ihre Platzierung läuft am ${date} ab`,
    heading: 'Platzierung läuft bald ab',
    intro: `Ihre Platzierung endet am ${date}. Verlängern Sie sie rechtzeitig, damit Ihre Profile im Katalog bleiben.`,
    button: 'Platzierung verlängern',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Nach dem Ablauf bleiben die Profile noch einige Tage sichtbar, danach werden sie deaktiviert. Nach einer Zahlung kehren sie automatisch zurück.',
  }),
  en: (date) => ({
    subject: `Noova — your listing expires on ${date}`,
    heading: 'Your listing is about to expire',
    intro: `Your listing ends on ${date}. Renew it in time to keep your profiles in the catalog.`,
    button: 'Renew listing',
    fallback: 'If the button does not work, open this link:',
    note: 'After expiry the profiles stay visible for a few more days, then they are unpublished. They come back automatically once you pay.',
  }),
  es: (date) => ({
    subject: `Noova — tu publicación termina el ${date}`,
    heading: 'La publicación está a punto de terminar',
    intro: `Tu publicación finaliza el ${date}. Prorrógala a tiempo para que tus perfiles sigan en el catálogo.`,
    button: 'Prorrogar la publicación',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'Tras el vencimiento los perfiles siguen visibles unos días más y después dejan de publicarse. Vuelven automáticamente en cuanto pagues.',
  }),
  fr: (date) => ({
    subject: `Noova — votre publication expire le ${date}`,
    heading: 'Votre publication va bientôt expirer',
    intro: `Votre publication prend fin le ${date}. Prolongez-la à temps pour que vos profils restent au catalogue.`,
    button: 'Prolonger la publication',
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: 'Après expiration, les profils restent visibles quelques jours, puis sont dépubliés. Ils reviennent automatiquement dès le paiement.',
  }),
  ru: (date) => ({
    subject: `Noova — размещение заканчивается ${date}`,
    heading: 'Срок размещения скоро выйдет',
    intro: `Ваше размещение действует до ${date}. Продлите его заранее, чтобы анкеты остались в каталоге.`,
    button: 'Продлить размещение',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'После окончания срока анкеты ещё несколько дней остаются в каталоге, затем снимаются с публикации. После оплаты они вернутся сами.',
  }),
};

const GRACE: Record<Locale, (date: string) => Copy> = {
  de: (date) => ({
    subject: 'Noova — Platzierung abgelaufen, Profile noch sichtbar',
    heading: 'Ihre Platzierung ist abgelaufen',
    intro: `Die bezahlte Laufzeit ist zu Ende. Bis ${date} bleiben Ihre Profile noch im Katalog — das ist die Kulanzfrist. Verlängern Sie jetzt, sonst werden sie deaktiviert.`,
    button: 'Jetzt verlängern',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Nach einer Zahlung läuft die Platzierung ab heute weiter; nichts geht verloren.',
  }),
  en: (date) => ({
    subject: 'Noova — listing expired, profiles still visible',
    heading: 'Your listing has expired',
    intro: `The paid term is over. Until ${date} your profiles stay in the catalog — this is the grace period. Renew now, or they will be unpublished.`,
    button: 'Renew now',
    fallback: 'If the button does not work, open this link:',
    note: 'After payment the listing continues from today; nothing is lost.',
  }),
  es: (date) => ({
    subject: 'Noova — publicación vencida, los perfiles siguen visibles',
    heading: 'Tu publicación ha vencido',
    intro: `El plazo pagado ha terminado. Hasta el ${date} tus perfiles siguen en el catálogo: es el periodo de cortesía. Prorroga ahora o dejarán de publicarse.`,
    button: 'Prorrogar ahora',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'Tras el pago la publicación continúa desde hoy; no se pierde nada.',
  }),
  fr: (date) => ({
    subject: 'Noova — publication expirée, profils encore visibles',
    heading: 'Votre publication a expiré',
    intro: `La durée payée est terminée. Jusqu'au ${date}, vos profils restent au catalogue : c'est la période de grâce. Prolongez maintenant, sinon ils seront dépubliés.`,
    button: 'Prolonger maintenant',
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: "Après paiement, la publication reprend à partir d'aujourd'hui ; rien n'est perdu.",
  }),
  ru: (date) => ({
    subject: 'Noova — срок размещения вышел, анкеты пока в каталоге',
    heading: 'Срок размещения вышел',
    intro: `Оплаченный срок закончился. До ${date} анкеты ещё остаются в каталоге — это льготный период. Продлите сейчас, иначе они будут сняты с публикации.`,
    button: 'Продлить сейчас',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'После оплаты размещение продолжится с сегодняшнего дня, ничего не пропадёт.',
  }),
};

const EXPIRED: Record<Locale, Copy> = {
  de: {
    subject: 'Noova — Profile deaktiviert: Platzierung nicht verlängert',
    heading: 'Ihre Profile sind nicht mehr sichtbar',
    intro:
      'Die Kulanzfrist ist abgelaufen, und Ihre Profile wurden aus dem Katalog genommen. Ihre Daten und Fotos bleiben erhalten.',
    button: 'Platzierung bezahlen',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Nach der Zahlung erscheinen die Profile automatisch wieder im Katalog — ohne erneute Prüfung.',
  },
  en: {
    subject: 'Noova — profiles unpublished: listing not renewed',
    heading: 'Your profiles are no longer visible',
    intro:
      'The grace period has ended and your profiles were removed from the catalog. Your data and photos are kept.',
    button: 'Pay for listing',
    fallback: 'If the button does not work, open this link:',
    note: 'After payment the profiles return to the catalog automatically — no new review needed.',
  },
  es: {
    subject: 'Noova — perfiles sin publicar: la publicación no se ha prorrogado',
    heading: 'Tus perfiles ya no son visibles',
    intro:
      'El periodo de cortesía ha terminado y tus perfiles se han retirado del catálogo. Tus datos y fotos se conservan.',
    button: 'Pagar la publicación',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'Tras el pago los perfiles vuelven al catálogo automáticamente, sin nueva revisión.',
  },
  fr: {
    subject: 'Noova — profils dépubliés : publication non prolongée',
    heading: 'Vos profils ne sont plus visibles',
    intro:
      'La période de grâce est terminée et vos profils ont été retirés du catalogue. Vos données et vos photos sont conservées.',
    button: 'Payer la publication',
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: 'Après paiement, les profils reviennent au catalogue automatiquement, sans nouvelle vérification.',
  },
  ru: {
    subject: 'Noova — анкеты сняты с публикации: размещение не продлено',
    heading: 'Анкеты больше не видны',
    intro:
      'Льготный период закончился, и анкеты сняты с публикации. Данные и фотографии сохранены.',
    button: 'Оплатить размещение',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'После оплаты анкеты вернутся в каталог сами — повторная проверка не нужна.',
  },
};

export function listingReminderMail(locale: Locale, expiresAt: Date) {
  return buildMail(
    REMINDER[locale](formatDate(locale, expiresAt)),
    locale,
    subscriptionLink(locale),
  );
}

export function listingGraceMail(locale: Locale, graceEndsAt: Date) {
  return buildMail(
    GRACE[locale](formatDate(locale, graceEndsAt)),
    locale,
    subscriptionLink(locale),
  );
}

export function listingExpiredMail(locale: Locale) {
  return buildMail(EXPIRED[locale], locale, subscriptionLink(locale));
}
