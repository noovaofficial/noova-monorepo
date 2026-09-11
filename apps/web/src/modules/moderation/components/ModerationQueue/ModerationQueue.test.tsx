// @vitest-environment jsdom
import type { QueueCount } from '@noova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../messages/ru.json';
import { ModerationQueue } from './index';

vi.mock('@/modules/auth/components/SessionProvider', () => ({
  useSession: () => ({ user: { role: 'moderator' }, status: 'authenticated' }),
}));

const api = vi.hoisted(() => ({ fetchQueue: vi.fn(), fetchQueueCount: vi.fn() }));
vi.mock('@/modules/moderation/api', () => api);

vi.mock('@/shared/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const t = messages.moderation;

function counts(overrides: Partial<QueueCount> = {}): QueueCount {
  return {
    photos: 0,
    verifications: 0,
    identity: 0,
    comments: 0,
    reports: 0,
    urgentReports: 0,
    blockedProfiles: 0,
    blockedUsers: 0,
    total: 0,
    ...overrides,
  };
}

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="ru" messages={messages}>
        <ModerationQueue />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const tab = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });

describe('числа на вкладках модерации', () => {
  it('у каждой вкладки своё поле счётчика очереди', async () => {
    api.fetchQueue.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    api.fetchQueueCount.mockResolvedValue(
      counts({
        reports: 1,
        photos: 2,
        verifications: 3,
        identity: 4,
        comments: 5,
        blockedProfiles: 6,
        blockedUsers: 7,
        total: 15,
      }),
    );
    renderQueue();

    await waitFor(() => expect(within(tab(t.tabReports)).getByText('1')).toBeTruthy());
    expect(within(tab(t.tabPhotos)).getByText('2')).toBeTruthy();
    expect(within(tab(t.tabVerifications)).getByText('3')).toBeTruthy();
    expect(within(tab(t.tabIdentity)).getByText('4')).toBeTruthy();
    expect(within(tab(t.tabComments)).getByText('5')).toBeTruthy();
    expect(within(tab(t.tabBlockedProfiles)).getByText('6')).toBeTruthy();
    expect(within(tab(t.tabBlockedUsers)).getByText('7')).toBeTruthy();
    // У «Все» числа нет: общий итог уже на бейдже в сайдбаре.
    expect(tab(t.tabAll).textContent).toBe(t.tabAll);
  });

  it('нулевое число не показывается', async () => {
    api.fetchQueue.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    api.fetchQueueCount.mockResolvedValue(counts({ photos: 2, total: 2 }));
    renderQueue();

    await waitFor(() => expect(within(tab(t.tabPhotos)).getByText('2')).toBeTruthy());
    expect(tab(t.tabReports).textContent).toBe(t.tabReports);
    expect(tab(t.tabBlockedUsers).textContent).toBe(t.tabBlockedUsers);
  });
});
