/**
 * Как показать, когда кончается ТОП. До недели — обратный отсчёт: до 48 часов
 * включительно в часах, дальше в полных сутках; больше недели — дата.
 */
export type TopExpiry =
  | { kind: 'hours'; value: number }
  | { kind: 'days'; value: number }
  | { kind: 'date'; date: Date };

const HOUR = 60 * 60 * 1000;

export function topExpiry(expiresAt: Date, now: Date = new Date()): TopExpiry {
  const diff = expiresAt.getTime() - now.getTime();
  const hours = Math.max(1, Math.ceil(diff / HOUR));
  if (hours <= 48) return { kind: 'hours', value: hours };
  if (hours < 7 * 24) return { kind: 'days', value: Math.floor(hours / 24) };
  return { kind: 'date', date: expiresAt };
}
