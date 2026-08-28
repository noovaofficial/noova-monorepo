import type { Locale } from '@noova/shared';

/**
 * Вёрстка письма: одна общая рамка для всех трёх писем авторизации.
 *
 * Правила здесь не веб-, а почтовые, и они объясняют почти каждое решение
 * ниже: таблицы вместо флексбокса и грида (Outlook рендерит Word'ом),
 * инлайновые стили (Gmail вырезает `<style>` в некоторых режимах), ширина
 * 600px (шире обрезается в панели просмотра), шрифты только системные.
 *
 * **Ни одной картинки.** Логотип — текстом. Любая внешняя картинка требует
 * от получателя разрешить загрузку, а до тех пор письмо выглядит поломанным;
 * и она же работает как счётчик открытий — почтовый сервер видит, кто и когда
 * прочитал письмо с каталога 18+. Для нас это та же утечка особой категории,
 * ради которой плитки карты идут через свой домен.
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

/** Подвал. Ответить на письмо нельзя — почтовый ящик только на отправку. */
const FOOTER: Record<Locale, string> = {
  de: 'Diese Nachricht wurde automatisch versendet. Bitte antworten Sie nicht darauf.',
  en: 'This message was sent automatically. Please do not reply to it.',
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
                <td style="padding:0 0 16px 0;">
                  <div style="border-top:1px solid ${COLOR.border};font-size:1px;line-height:1px;">&nbsp;</div>
                </td>
              </tr>
              <tr>
                <td align="left" style="font-family:${FONT};font-size:13px;line-height:20px;color:${COLOR.muted};">
                  ${esc(note)}
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
          <td style="padding:24px 24px 8px 24px;font-family:${FONT};font-size:28px;font-weight:700;line-height:34px;color:${COLOR.text};">
            noova
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
