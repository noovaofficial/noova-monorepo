// @vitest-environment jsdom
import type { Analytics } from '@noova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../messages/ru.json';
import { AnalyticsPanel } from './index';

const session = vi.hoisted(() => ({
  value: { user: { role: 'advertiser' }, status: 'authenticated' } as {
    user: { role: string } | null;
    status: string;
  },
}));
vi.mock('@/modules/auth/components/SessionProvider', () => ({ useSession: () => session.value }));

const api = vi.hoisted(() => ({ fetchAnalytics: vi.fn() }));
vi.mock('@/modules/analytics/api', () => api);

// Переход на вход — побочный эффект гостевой ветки; сам переход не проверяем.
vi.mock('@/shared/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/account/analytics',
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const t = messages.analytics;

/** Отчёт с заданными итогами; ряд и остальное — правдоподобный минимум. */
function report(overrides: Partial<Analytics> = {}): Analytics {
  const split = (total: number, registered: number) => ({
    total,
    registered,
    anonymous: total - registered,
  });
  return {
    period: 'd30',
    from: '2026-08-05',
    to: '2026-09-03',
    totals: {
      views: split(1248, 412),
      favorites: split(37, 37),
      contactReveals: split(214, 61),
      contactClicks: split(96, 28),
    },
    series: [
      { date: '2026-09-02', views: 40, favorites: 1, contactReveals: 7, contactClicks: 3 },
      { date: '2026-09-03', views: 55, favorites: 2, contactReveals: 9, contactClicks: 4 },
    ],
    contacts: [
      { type: 'phone', clicks: 20 },
      { type: 'whatsapp', clicks: 76 },
      { type: 'telegram', clicks: 0 },
      { type: 'viber', clicks: 0 },
    ],
    profiles: [],
    ...overrides,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ru" messages={messages}>
        <AnalyticsPanel />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Карточка метрики — кнопка, подписанная названием метрики. */
const card = (name: string) =>
  screen.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });

beforeEach(() => {
  session.value = { user: { role: 'advertiser' }, status: 'authenticated' };
  api.fetchAnalytics.mockResolvedValue(report());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('доступ', () => {
  it('клиенту статистика не показывается', async () => {
    session.value = { user: { role: 'client' }, status: 'authenticated' };

    renderPanel();

    // Статистика анкеты — данные о её посетителях; чужому их отдавать нельзя,
    // и запрос уходить не должен вовсе.
    expect(screen.getByText(t.onlyAdvertisers)).toBeTruthy();
    expect(api.fetchAnalytics).not.toHaveBeenCalled();
  });
});

describe('период', () => {
  it('по умолчанию запрашивает тридцать дней', async () => {
    renderPanel();
    await waitFor(() => expect(api.fetchAnalytics).toHaveBeenCalledWith('d30'));
  });

  it('перезапрашивает отчёт при смене периода', async () => {
    renderPanel();
    await waitFor(() => expect(api.fetchAnalytics).toHaveBeenCalledWith('d30'));

    await userEvent.click(screen.getByRole('button', { name: t.period_d7 }));

    // Период входит в ключ запроса: иначе переключение отдавало бы
    // прежний отчёт из кэша, и цифры не менялись бы вовсе.
    await waitFor(() => expect(api.fetchAnalytics).toHaveBeenCalledWith('d7'));
  });
});

describe('карточки итогов', () => {
  it('показывают итог и разбивку на вошедших и гостей', async () => {
    renderPanel();
    await waitFor(() => expect(card(t.metric_views)).toBeTruthy());

    const views = card(t.metric_views);
    expect(views.textContent).toContain('1');
    expect(views.textContent).toContain('412');
    expect(views.textContent).toContain('836');
  });

  it('не показывают разбивку у избранного', async () => {
    renderPanel();
    await waitFor(() => expect(card(t.metric_favorites)).toBeTruthy());

    // Отметить анкету может только вошедший клиент — «гостевых» добавлений
    // не бывает по устройству функции, и строка «0 гостей» вводила бы в
    // заблуждение.
    expect(card(t.metric_favorites).textContent).not.toContain('37 вошли');
  });

  it('не показывают долей между ступенями', async () => {
    renderPanel();
    await waitFor(() => expect(card(t.metric_contactClicks)).toBeTruthy());

    // Убраны намеренно: клик по двум каналам после одного показа даёт
    // больше ста процентов, и цифра читается поломкой, а не конверсией.
    expect(card(t.metric_contactClicks).textContent).not.toContain('%');
  });
});

describe('график', () => {
  it('переключается карточкой и подписывается выбранной метрикой', async () => {
    renderPanel();
    await waitFor(() => expect(card(t.metric_views)).toBeTruthy());

    // Заголовок раздела с графиком совпадает с названием выбранной метрики.
    expect(screen.getByRole('heading', { name: t.metric_views })).toBeTruthy();

    await userEvent.click(card(t.metric_contactClicks));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: t.metric_contactClicks })).toBeTruthy(),
    );
    // Одна метрика за раз: у просмотров и кликов разница на порядок, и на
    // общей шкале клики легли бы в ноль.
    expect(screen.queryByRole('heading', { name: t.metric_views })).toBeNull();
  });

  it('рисует столбик на каждый день ряда', async () => {
    const { container } = renderPanel();
    await waitFor(() => expect(container.querySelector('svg')).toBeTruthy());

    expect(container.querySelectorAll('svg rect')).toHaveLength(2);
  });
});

describe('каналы связи', () => {
  it('показывают долю каждого канала', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(t.contactsTitle)).toBeTruthy());

    const row = screen.getByText(messages.contacts.whatsapp).closest('li');
    expect(row).toBeTruthy();
    // 76 из 96 кликов — доли здесь складываются в сто, в отличие от воронки.
    expect(within(row as HTMLElement).getByText(/79%/)).toBeTruthy();
  });

  it('вместо нулей объясняют, что переходов ещё не было', async () => {
    api.fetchAnalytics.mockResolvedValue(
      report({
        totals: {
          ...report().totals,
          contactClicks: { total: 0, registered: 0, anonymous: 0 },
        },
        contacts: [
          { type: 'phone', clicks: 0 },
          { type: 'whatsapp', clicks: 0 },
          { type: 'telegram', clicks: 0 },
          { type: 'viber', clicks: 0 },
        ],
      }),
    );

    renderPanel();

    // Четыре нуля и четыре пустые полоски — не отчёт, а недоразумение.
    await waitFor(() => expect(screen.getByText(t.contactsEmpty)).toBeTruthy());
  });
});

describe('разбивка по анкетам', () => {
  it('не строится, когда сервер её не прислал', async () => {
    renderPanel();
    await waitFor(() => expect(card(t.metric_views)).toBeTruthy());

    // У индивидуалки и салона анкета одна, и таблица из одной строки
    // повторяла бы карточки итогов.
    expect(screen.queryByText(t.profilesTitle)).toBeNull();
  });

  it('строится у агентства и ставит самую заметную анкету первой', async () => {
    api.fetchAnalytics.mockResolvedValue(
      report({
        profiles: [
          {
            profileId: 'p2',
            displayName: 'Вторая',
            slug: 'vtoraya',
            views: 900,
            favorites: 20,
            contactReveals: 150,
            contactClicks: 70,
          },
          {
            profileId: 'p1',
            displayName: 'Первая',
            slug: 'pervaya',
            views: 348,
            favorites: 17,
            contactReveals: 64,
            contactClicks: 26,
          },
        ],
      }),
    );

    renderPanel();
    await waitFor(() => expect(screen.getByText(t.profilesTitle)).toBeTruthy());

    // Список читают, чтобы найти отстающую анкету; порядок «как заведены»
    // этому не помогает.
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(names).toEqual(['Вторая', 'Первая']);
  });
});
