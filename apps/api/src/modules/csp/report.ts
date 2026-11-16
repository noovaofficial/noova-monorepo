/**
 * Разбор отчёта браузера о нарушении Content-Security-Policy.
 *
 * Браузеры шлют два формата: старый (`report-uri`, объект `csp-report` с
 * ключами через дефис) и новый (Reporting API, массив с `body` в camelCase).
 * Сводим к одной записи для лога.
 */
export type CspViolation = {
  directive: string;
  blocked: string;
  page: string;
  source: string;
  line: number | null;
  sample: string;
  disposition: string;
};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

/** Адрес без строки запроса: в ней бывают токены сброса пароля и почты. */
function withoutQuery(value: unknown): string {
  return text(value, 300).split(/[?#]/)[0] ?? '';
}

function fromRecord(record: Record<string, unknown>): CspViolation | null {
  const pick = (...keys: string[]) => keys.map((key) => record[key]).find((v) => v !== undefined);
  const directive = text(
    pick('effective-directive', 'effectiveDirective', 'violated-directive'),
    80,
  );
  if (!directive) return null;
  const line = pick('line-number', 'lineNumber');
  return {
    directive,
    blocked: withoutQuery(pick('blocked-uri', 'blockedURL')),
    page: withoutQuery(pick('document-uri', 'documentURL')),
    source: withoutQuery(pick('source-file', 'sourceFile')),
    line: typeof line === 'number' ? line : null,
    sample: text(pick('script-sample', 'sample'), 120),
    disposition: text(pick('disposition'), 20),
  };
}

export function parseCspReport(raw: string): CspViolation[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray(data) ? data.slice(0, 10) : [data];
  const out: CspViolation[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const wrapped =
      (item as Record<string, unknown>)['csp-report'] ?? (item as Record<string, unknown>).body;
    if (typeof wrapped !== 'object' || wrapped === null) continue;
    const violation = fromRecord(wrapped as Record<string, unknown>);
    if (violation) out.push(violation);
  }
  return out;
}

const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/;

/**
 * Шум, который к сайту отношения не имеет: расширения браузера вставляют в
 * страницу свои скрипты и стили, и политика честно о них докладывает. В лог
 * такие отчёты не пишем — иначе настоящее нарушение в них утонет.
 */
export function isExtensionNoise(violation: CspViolation): boolean {
  return EXTENSION.test(violation.blocked) || EXTENSION.test(violation.source);
}
