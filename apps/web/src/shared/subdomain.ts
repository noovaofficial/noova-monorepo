/**
 * Хост из `NEXT_PUBLIC_SITE_URL` — апекс, с которым сравниваются поддомены
 * агентств (N-38). Общий модуль: `proxy.ts` (маршрутизация, до next-intl) и
 * клиентская навигация (`Link`/`useRouter`) должны решать одинаково, иначе
 * одно место посчитает запрос поддоменом, а другое — нет.
 */
export function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').hostname;
  } catch {
    return 'localhost';
  }
}

/** `host` — как из заголовка `Host`, с портом или без. */
export function agencySlugFromHost(host: string): string | null {
  const apex = siteHost();
  if (apex === 'localhost' || apex === '127.0.0.1') return null;
  const bare = host.split(':')[0] ?? '';
  const suffix = `.${apex}`;
  if (!bare.endsWith(suffix)) return null;
  const slug = bare.slice(0, -suffix.length);
  return slug || null;
}
