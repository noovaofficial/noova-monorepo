import type { Locale } from '@noova/shared';
import { LOGO_CID } from './logo.js';

/**
 * Вёрстка письма: одна общая рамка для всех трёх писем авторизации.
 *
 * Правила здесь не веб-, а почтовые, и они объясняют почти каждое решение
 * ниже: таблицы вместо флексбокса и грида (Outlook рендерит Word'ом),
 * инлайновые стили (Gmail вырезает `<style>` в некоторых режимах), ширина
 * 600px (шире обрезается в панели просмотра), шрифты только системные.
 *
 * **Ни одной внешней картинки.** Знак едет вложением внутри письма и
 * подключается по `cid:` (см. logo.ts). Ссылка на картинку не годится: она
 * требует от получателя разрешить загрузку, а до тех пор письмо выглядит
 * поломанным, и она же работает счётчиком открытий — сервер видит, кто и
 * когда прочитал письмо с каталога 18+. Для нас это та же утечка особой
 * категории, ради которой плитки карты идут через свой домен. Вложение
 * наружу не ходит вовсе.
 *
 * **Ни одного редиректа-трекера.** Ссылка в письме ведёт прямо на сайт.
 * Обёртка вида `go2_link_tracker?url=...` ломает и доверие получателя
 * (в статусной строке чужой домен), и репутацию домена у спам-фильтров.
 */

/** Фирменные цвета из tokens.css. Здесь копией: письмо переменных не знает. */
const COLOR = {
  page: '#f0e9e7',
  card: '#ffffff',
  text: '#251a24',
  muted: '#6e5f6a',
  border: '#e7ddda',
  /** Плашка внутри карточки: между фоном страницы и белым. */
  panel: '#f7f1ef',
  brand: '#e0457b',
  onBrand: '#ffffff',
} as const;

const FONT = 'Arial, Helvetica, sans-serif';

/** Единственное место, где значения попадают в разметку, — значит, единственное,
 *  где нужно экранирование. Ссылка содержит токен, и кавычка в нём порвала бы
 *  атрибут. */
function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

type Action = {
  href: string;
  /** Надпись на кнопке. */
  label: string;
  /** «Если кнопка не работает» — перед продублированной ссылкой. */
  fallback: string;
};

export type EmailContent = {
  heading: string;
  intro: string;
  action?: Action;
  /** Мелким шрифтом под разделителем: срок жизни ссылки и что делать, если это не вы. */
  note?: string;
};

/**
 * Предупреждение о мошенниках. Каталоги 18+ копируют и пишут их посетителям
 * от имени площадки — просят «подтвердить пароль», уводят в мессенджеры.
 * Дешевле всего это ломается тем, что человек заранее знает: мы так не пишем.
 * Стоит в каждом письме, а не только в первом: помнить будут последнее.
 */
const SECURITY: Record<Locale, string> = {
  de: 'Noova fragt niemals per E-Mail nach Ihrem Passwort und schreibt Sie nie zuerst in Messengern an. Erhalten Sie eine solche Nachricht, ist es Betrug.',
  en: 'Noova never asks for your password by email and never messages you first on any messenger. If you get such a message, it is a scam.',
  es: 'Noova nunca pide tu contraseña por correo ni te escribe primero en mensajería. Si recibes un mensaje así, es una estafa.',
  fr: "Noova ne demande jamais votre mot de passe par e-mail et ne vous écrit jamais en premier sur une messagerie. Si vous recevez un tel message, c'est une escroquerie.",
  ru: 'Noova никогда не спрашивает пароль в письмах и не пишет первой в мессенджерах. Если вам пришло такое сообщение — это мошенники.',
};

/**
 * Куда писать. Стоит рядом с предупреждением о мошенниках намеренно: «мы не
 * пишем первыми» работает вдвое лучше, когда тут же сказано, откуда мы всё-таки
 * пишем. Источник значений — страница контактов, apps/web/.../contact/page.tsx.
 */
const SUPPORT = {
  telegram: '@noovasupport',
  telegramHref: 'https://t.me/noovasupport',
  email: 'support@noova.cc',
} as const;

const SUPPORT_LABEL: Record<Locale, string> = {
  de: 'Fragen? Schreiben Sie uns:',
  en: 'Questions? Get in touch:',
  es: '¿Preguntas? Escríbenos:',
  fr: 'Des questions ? Écrivez-nous :',
  ru: 'Вопросы — пишите нам:',
};

/** Подвал. Ответить на письмо нельзя — почтовый ящик только на отправку. */
const FOOTER: Record<Locale, string> = {
  de: 'Diese Nachricht wurde automatisch versendet. Bitte antworten Sie nicht darauf.',
  en: 'This message was sent automatically. Please do not reply to it.',
  es: 'Este mensaje se ha enviado automáticamente. No respondas a él.',
  fr: 'Ce message a été envoyé automatiquement. Merci de ne pas y répondre.',
  ru: 'Письмо отправлено автоматически, отвечать на него не нужно.',
};

export function renderEmail(locale: Locale, content: EmailContent): string {
  const { heading, intro, action, note } = content;

  // Предзаголовок: то, что почтовый клиент показывает в списке рядом с темой.
  // Без него туда попадает начало разметки или слово «noova» — ни то, ни
  // другое не помогает понять, о чём письмо.
  const preheader = `
    <div style="display:none;font-size:1px;color:${COLOR.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${esc(intro)}
    </div>`;

  const button = action
    ? `
              <tr>
                <td align="left" style="padding:0 0 20px 0;">
                  <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:separate;line-height:100%;">
                    <tr>
                      <td align="center" bgcolor="${COLOR.brand}" role="presentation" style="border-radius:8px;mso-padding-alt:12px 28px;background:${COLOR.brand};" valign="middle">
                        <a href="${esc(action.href)}" target="_blank" rel="noopener" style="display:inline-block;background:${COLOR.brand};color:${COLOR.onBrand};font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;text-decoration:none;padding:12px 28px;mso-padding-alt:0;border-radius:8px;">${esc(action.label)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="left" style="padding:0 0 16px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${COLOR.muted};">
                  ${esc(action.fallback)}<br>
                  <a href="${esc(action.href)}" target="_blank" rel="noopener" style="color:${COLOR.muted};word-break:break-all;">${esc(action.href)}</a>
                </td>
              </tr>`
    : '';

  const footnote = note
    ? `
              <tr>
                <td style="padding:0;">
                  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td bgcolor="${COLOR.panel}" style="background:${COLOR.panel};border-radius:8px;padding:14px 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLOR.muted};">
                        ${esc(note)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : '';

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>noova</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.page};">
${preheader}
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:${COLOR.page};">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;background:${COLOR.card};border-radius:12px;">
        <tr>
          <td style="padding:24px 24px 8px 24px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td width="44" style="width:44px;">
                  <!-- Вложение, а не ссылка. Клиент, прячущий встроенные
                       картинки, покажет alt — слово рядом всё равно на месте. -->
                  <img src="cid:${LOGO_CID}" width="44" height="44" alt="noova"
                       style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;">
                </td>
                <td style="padding-left:12px;font-family:${FONT};font-size:28px;font-weight:700;line-height:34px;color:${COLOR.text};">
                  noova
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 24px 0 24px;font-family:${FONT};font-size:22px;font-weight:700;line-height:30px;color:${COLOR.text};">
            ${esc(heading)}
          </td>
        </tr>

        <tr>
          <td style="padding:16px 24px 24px 24px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="left" style="padding:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:22px;color:${COLOR.text};">
                  ${esc(intro)}
                </td>
              </tr>${button}${footnote}
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;">
        <tr>
          <td style="padding:16px 0 0 0;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td bgcolor="${COLOR.card}" style="background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">
                  ${esc(SUPPORT_LABEL[locale])}
                  <a href="${SUPPORT.telegramHref}" target="_blank" rel="noopener" style="color:${COLOR.brand};text-decoration:none;">${SUPPORT.telegram}</a>
                  &nbsp;·&nbsp;
                  <a href="mailto:${SUPPORT.email}" style="color:${COLOR.brand};text-decoration:none;">${SUPPORT.email}</a>
                  <br><br>
                  ${esc(SECURITY[locale])}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 24px 0 24px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted};">
            ${esc(FOOTER[locale])}
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}
