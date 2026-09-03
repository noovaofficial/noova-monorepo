// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoritesProvider, rememberPendingFavorite, useFavorites } from './index';

/**
 * Сеанс подменяется целиком: тест про избранное, а не про вход. Настоящий
 * `SessionProvider` потянул бы за собой запрос к `/auth/me` и куку-подсказку,
 * и падение теста рассказывало бы про них, а не про сердце.
 */
const session = vi.hoisted(() => ({
  value: { user: { role: 'client' }, status: 'authenticated' } as {
    user: { role: string } | null;
    status: string;
  },
}));

vi.mock('@/modules/auth/components/SessionProvider', () => ({
  useSession: () => session.value,
}));

const api = vi.hoisted(() => ({
  fetchFavoriteIds: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

vi.mock('@/modules/favorites/api', () => api);

/** Показывает состояние провайдера текстом — читать его проще, чем хук. */
function Probe() {
  const { ids, toggle } = useFavorites();
  return (
    <>
      <span data-testid="ids">{ids === null ? 'не-загружено' : [...ids].sort().join(',')}</span>
      <button type="button" onClick={() => void toggle('p1')}>
        переключить
      </button>
    </>
  );
}

function renderProvider(children: ReactNode = <Probe />) {
  // Без повторов: иначе неудачная мутация ретраится, и тест про откат
  // ждёт его молча до таймаута.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FavoritesProvider>{children}</FavoritesProvider>
    </QueryClientProvider>,
  );
}

const ids = () => screen.getByTestId('ids').textContent;
const click = async () => {
  await act(async () => {
    screen.getByRole('button', { name: 'переключить' }).click();
  });
};

/** Обещание, которым тест управляет вручную: нужно, чтобы поймать состояние
 *  экрана между нажатием и ответом сервера. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  session.value = { user: { role: 'client' }, status: 'authenticated' };
  api.fetchFavoriteIds.mockResolvedValue([]);
  api.addFavorite.mockResolvedValue(undefined);
  api.removeFavorite.mockResolvedValue(undefined);
  sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('оптимистичная отметка', () => {
  it('закрашивает сердце до ответа сервера', async () => {
    const pending = deferred();
    api.addFavorite.mockReturnValue(pending.promise);

    renderProvider();
    await waitFor(() => expect(ids()).toBe(''));
    await click();

    // `waitFor` здесь ждёт перерисовку React, а не сервер: запрос к нему
    // всё ещё висит — обещание `pending` не разрешено ни здесь, ни выше.
    // Значит закрашенное сердце пришло из оптимистичного обновления, и
    // прийти больше неоткуда.
    await waitFor(() => expect(ids()).toBe('p1'));
    expect(api.addFavorite).toHaveBeenCalledWith('p1');

    await act(async () => {
      pending.resolve();
    });
  });

  it('возвращает прежнее состояние, когда сервер отказал', async () => {
    api.addFavorite.mockRejectedValue(new Error('сеть недоступна'));

    renderProvider();
    await waitFor(() => expect(ids()).toBe(''));
    await click();

    // Откат ровно к снимку до нажатия, а не к пустому множеству.
    await waitFor(() => expect(ids()).toBe(''));
  });

  it('не роняет приложение отказом сервера', async () => {
    api.addFavorite.mockRejectedValue(new Error('сеть недоступна'));

    renderProvider();
    await waitFor(() => expect(ids()).toBe(''));

    // Необработанное отклонение из обработчика нажатия уронило бы страницу
    // целиком: сердце — не та функция, ради которой это допустимо.
    await expect(click()).resolves.toBeUndefined();
  });
});

describe('направление действия', () => {
  /**
   * Регрессия, из-за которой добавление не работало вовсе. Раньше намерение
   * выводили из кэша внутри `mutationFn`, но `onMutate` по контракту React
   * Query отрабатывает раньше и успевает записать туда оптимистичное
   * значение. Добавление читалось как «уже в избранном» и уходило на сервер
   * запросом DELETE.
   */
  it('добавление шлёт добавление, а не удаление', async () => {
    renderProvider();
    await waitFor(() => expect(ids()).toBe(''));
    await click();

    expect(api.addFavorite).toHaveBeenCalledWith('p1');
    expect(api.removeFavorite).not.toHaveBeenCalled();
  });

  it('снятие отметки шлёт удаление', async () => {
    api.fetchFavoriteIds.mockResolvedValue(['p1']);

    renderProvider();
    await waitFor(() => expect(ids()).toBe('p1'));
    await click();

    expect(api.removeFavorite).toHaveBeenCalledWith('p1');
    expect(api.addFavorite).not.toHaveBeenCalled();
  });
});

describe('намерение гостя, отложенное до входа', () => {
  it('применяется после входа и очищается', async () => {
    rememberPendingFavorite('p9');
    api.fetchFavoriteIds.mockResolvedValue([]);

    renderProvider();

    await waitFor(() => expect(api.addFavorite).toHaveBeenCalledWith('p9'));
    // Отметка видна к первому же рендеру, а не после обновления страницы.
    await waitFor(() => expect(ids()).toBe('p9'));
    // Иначе то же сердце всплывало бы при каждом следующем входе.
    expect(sessionStorage.getItem('noova_pending_favorite')).toBeNull();
  });

  it('не повторяет то, что уже отмечено', async () => {
    rememberPendingFavorite('p1');
    api.fetchFavoriteIds.mockResolvedValue(['p1']);

    renderProvider();

    await waitFor(() => expect(ids()).toBe('p1'));
    expect(api.addFavorite).not.toHaveBeenCalled();
  });

  it('переживает анкету, снятую с публикации, пока человек входил', async () => {
    rememberPendingFavorite('p9');
    api.addFavorite.mockRejectedValue(new Error('анкета снята'));

    renderProvider();

    // Список должен загрузиться, а не остаться в «не загружено»: отказ по
    // одному отложенному действию не повод не показать избранное вовсе.
    await waitFor(() => expect(ids()).toBe(''));
  });
});

describe('чужая роль', () => {
  it('не запрашивает избранное у рекламодателя', async () => {
    session.value = { user: { role: 'advertiser' }, status: 'authenticated' };

    renderProvider();

    // API ответил бы 403: избранное — функция клиента, и владелица анкеты
    // не должна собирать себе список конкуренток.
    await waitFor(() => expect(ids()).toBe('не-загружено'));
    expect(api.fetchFavoriteIds).not.toHaveBeenCalled();
  });

  it('не запрашивает, пока сеанс ещё не известен', async () => {
    session.value = { user: null, status: 'loading' };

    renderProvider();

    await waitFor(() => expect(ids()).toBe('не-загружено'));
    expect(api.fetchFavoriteIds).not.toHaveBeenCalled();
  });
});
