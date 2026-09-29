// @vitest-environment jsdom
import type { Dashboard } from '@noova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../messages/ru.json';
import { InternalDashboard } from './index';

const session = vi.hoisted(() => ({
  value: { user: { role: 'admin' }, status: 'authenticated' } as {
    user: { role: string } | null;
    status: string;
  },
}));
vi.mock('@/modules/auth/components/SessionProvider', () => ({ useSession: () => session.value }));

const api = vi.hoisted(() => ({ fetchDashboard: vi.fn() }));
vi.mock('@/modules/moderation/api', () => api);

vi.mock('@/shared/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/dashboard',
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const t = messages.analytics;

function report(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    period: 'd30',
    from: '2026-08-05',
    to: '2026-09-03',
    sources: {
      rows: [
        {
          source: 'network',
          network: 'exoclick',
          utmCampaign: 'spring',
          sessions: 100,
          botSessions: 10,
          contacts: 20,
          costPerContactEurCents: null,
        },
      ],
      totals: { sessions: 100, botSessions: 10, contacts: 20 },
    },
    cities: {
      rows: [
        {
          city: 'berlin',
          category: 'escort',
          sessions: 40,
          profileViews: 30,
          contacts: 6,
          activeProfiles: 5,
          contactsPerProfile: 1.2,
          highDemand: false,
        },
        {
          city: 'leipzig',
          category: 'escort',
          sessions: 12,
          profileViews: 0,
          contacts: 3,
          activeProfiles: 0,
          contactsPerProfile: null,
          highDemand: true,
        },
      ],
    },
    revenue: {
      series: [
        { date: '2026-09-02', topupEurCents: 5000, spentListingGc: 200, spentTopGc: 300 },
        { date: '2026-09-03', topupEurCents: 3000, spentListingGc: 100, spentTopGc: 150 },
      ],
      totals: { topupEurCents: 8000, spentListingGc: 300, spentTopGc: 450 },
    },
    ...overrides,
  };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ru" messages={messages}>
        <InternalDashboard />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  session.value = { user: { role: 'admin' }, status: 'authenticated' };
  api.fetchDashboard.mockResolvedValue(report());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('доступ', () => {
  it('не админу дашборд не показывается, запрос не уходит', async () => {
    session.value = { user: { role: 'moderator' }, status: 'authenticated' };
    renderDashboard();

    expect(screen.getByText(t.adminOnly)).toBeTruthy();
    expect(api.fetchDashboard).not.toHaveBeenCalled();
  });
});

describe('период', () => {
  it('по умолчанию запрашивает тридцать дней и перезапрашивает при смене', async () => {
    renderDashboard();
    await waitFor(() => expect(api.fetchDashboard).toHaveBeenCalledWith('d30'));

    await userEvent.click(screen.getByRole('button', { name: t.period_d7 }));
    await waitFor(() => expect(api.fetchDashboard).toHaveBeenCalledWith('d7'));
  });
});

describe('источники', () => {
  it('показывает сеть, кампанию и долю ботов', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(t.dashSourcesTitle)).toBeTruthy());

    expect(screen.getByText('exoclick')).toBeTruthy();
    expect(screen.getByText('spring')).toBeTruthy();
    // 10 из 100 — 10% (в ru-локали с пробелом перед знаком).
    expect(screen.getByText(/10\s?%/)).toBeTruthy();
  });

  it('стоимость контакта — заглушка до фазы 7, а не ноль', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(t.dashSourcesTitle)).toBeTruthy());

    expect(screen.getAllByText(t.dashCostPending).length).toBeGreaterThan(0);
  });
});

describe('спрос по городам', () => {
  it('отмечает город с высоким спросом и не трогает остальные', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(t.dashCitiesTitle)).toBeTruthy());

    const rows = screen.getAllByRole('row');
    const berlin = rows.find((row) => row.textContent?.includes('berlin'));
    const leipzig = rows.find((row) => row.textContent?.includes('leipzig'));

    expect(within(berlin as HTMLElement).queryByText(t.dashHighDemand)).toBeNull();
    expect(within(leipzig as HTMLElement).getByText(t.dashHighDemand)).toBeTruthy();
  });
});

describe('выручка', () => {
  it('показывает итоги за период', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(t.dashRevenueTitle)).toBeTruthy());

    // 8000 центов = 80 €.
    expect(screen.getByText(/80/)).toBeTruthy();
  });
});
