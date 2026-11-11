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
  pl: (date) => ({
    subject: `Noova — Twoja publikacja wygasa ${date}`,
    heading: 'Twoja publikacja wkrótce wygaśnie',
    intro: `Twoja publikacja kończy się ${date}. Przedłuż ją na czas, aby profile pozostały w katalogu.`,
    button: 'Przedłuż publikację',
    fallback: 'Jeśli przycisk nie działa, otwórz ten link:',
    note: 'Po wygaśnięciu profile pozostają widoczne jeszcze kilka dni, a potem są wycofywane. Po opłaceniu wracają automatycznie.',
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
  pl: (date) => ({
    subject: 'Noova — publikacja wygasła, profile wciąż widoczne',
    heading: 'Twoja publikacja wygasła',
    intro: `Opłacony okres dobiegł końca. Do ${date} profile pozostają w katalogu — to okres karencji. Przedłuż teraz, inaczej zostaną wycofane.`,
    button: 'Przedłuż teraz',
    fallback: 'Jeśli przycisk nie działa, otwórz ten link:',
    note: 'Po opłaceniu publikacja będzie trwać od dziś; nic nie przepadnie.',
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
  pl: {
    subject: 'Noova — profile wycofane: publikacja nie została przedłużona',
    heading: 'Twoje profile nie są już widoczne',
    intro:
      'Okres karencji dobiegł końca, a Twoje profile zostały usunięte z katalogu. Twoje dane i zdjęcia zostają zachowane.',
    button: 'Opłać publikację',
    fallback: 'Jeśli przycisk nie działa, otwórz ten link:',
    note: 'Po opłaceniu profile automatycznie wracają do katalogu — bez ponownej weryfikacji.',
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

/**
 * Размещение в стране стало платным: до даты анкеты остаются в каталоге,
 * дальше их снимут. Письмо нужно, потому что без него снятие выглядит как
 * поломка: человек публиковал бесплатно и ничего не менял.
 */
const PLACEMENT_PAID: Record<Locale, (date: string) => Copy> = {
  de: (date) => ({
    subject: 'Noova — die Platzierung in Ihrem Land ist jetzt kostenpflichtig',
    heading: 'Die Platzierung ist jetzt kostenpflichtig',
    intro: `In Ihrem Land ist die Platzierung von Profilen jetzt kostenpflichtig. Bis ${date} bleiben Ihre Profile im Katalog. Schließen Sie ein Abo ab, damit sie nicht deaktiviert werden.`,
    button: 'Abo abschließen',
    fallback: 'Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:',
    note: 'Nach der Zahlung geht nichts verloren. Ohne Zahlung werden die Profile deaktiviert und erscheinen nach der Zahlung automatisch wieder.',
  }),
  en: (date) => ({
    subject: 'Noova — listing in your country is now paid',
    heading: 'Listing is now paid',
    intro: `Listing profiles in your country is now paid. Until ${date} your profiles stay in the catalog. Get a subscription so they are not unpublished.`,
    button: 'Get a subscription',
    fallback: 'If the button does not work, open this link:',
    note: 'Nothing is lost after payment. Without it the profiles are unpublished and come back automatically once you pay.',
  }),
  es: (date) => ({
    subject: 'Noova — la publicación en tu país ahora es de pago',
    heading: 'La publicación ahora es de pago',
    intro: `Publicar perfiles en tu país ahora es de pago. Hasta el ${date} tus perfiles siguen en el catálogo. Suscríbete para que no se retiren.`,
    button: 'Suscribirme',
    fallback: 'Si el botón no funciona, abre este enlace:',
    note: 'Tras el pago no se pierde nada. Sin él, los perfiles se retiran y vuelven automáticamente cuando pagues.',
  }),
  fr: (date) => ({
    subject: 'Noova — la publication dans votre pays est désormais payante',
    heading: 'La publication est désormais payante',
    intro: `La publication de profils dans votre pays est désormais payante. Jusqu'au ${date}, vos profils restent au catalogue. Abonnez-vous pour qu'ils ne soient pas dépubliés.`,
    button: "S'abonner",
    fallback: 'Si le bouton ne fonctionne pas, ouvrez ce lien :',
    note: "Après paiement, rien n'est perdu. Sans paiement, les profils sont dépubliés et reviennent automatiquement dès que vous payez.",
  }),
  ru: (date) => ({
    subject: 'Noova — размещение в вашей стране стало платным',
    heading: 'Размещение стало платным',
    intro: `В вашей стране размещение анкет теперь платное. До ${date} анкеты остаются в каталоге. Оформите подписку, чтобы их не сняли с публикации.`,
    button: 'Оформить подписку',
    fallback: 'Если кнопка не работает, откройте ссылку:',
    note: 'После оплаты ничего не пропадёт. Без оплаты анкеты будут сняты с публикации и вернутся сами, как только вы заплатите.',
  }),
  pl: (date) => ({
    subject: 'Noova — publikacja w Twoim kraju jest teraz płatna',
    heading: 'Publikacja jest teraz płatna',
    intro: `Publikacja profili w Twoim kraju jest teraz płatna. Do ${date} Twoje profile pozostają w katalogu. Wykup subskrypcję, aby nie zostały wycofane.`,
    button: 'Wykup subskrypcję',
    fallback: 'Jeśli przycisk nie działa, otwórz ten link:',
    note: 'Po opłaceniu nic nie przepadnie. Bez opłaty profile zostaną wycofane i wrócą automatycznie po zapłaceniu.',
  }),
};

export function placementPaidMail(locale: Locale, graceEndsAt: Date) {
  return buildMail(
    PLACEMENT_PAID[locale](formatDate(locale, graceEndsAt)),
    locale,
    subscriptionLink(locale),
  );
}
