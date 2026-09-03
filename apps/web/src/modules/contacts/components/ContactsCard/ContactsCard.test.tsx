// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../messages/ru.json';
import { ContactsCard } from './index';

const contacts = vi.hoisted(() => ({
  revealContacts: vi.fn(),
  RevealError: class RevealError extends Error {
    constructor(readonly status: number) {
      super(`Раскрытие контактов ответило ${status}`);
      this.name = 'RevealError';
    }
  },
}));
vi.mock('@/modules/contacts/api', () => contacts);

const analytics = vi.hoisted(() => ({ trackContactClick: vi.fn() }));
vi.mock('@/modules/analytics/api', () => analytics);

const t = messages.contacts;

function renderCard() {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ContactsCard slug="gloria-berlin" types={['phone', 'whatsapp']} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  contacts.revealContacts.mockResolvedValue({
    contacts: [
      { type: 'phone', value: '+491701234567' },
      { type: 'whatsapp', value: '+491701234567' },
    ],
  });
  analytics.trackContactClick.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('гейт показа', () => {
  it('до нажатия не выдаёт значений — ни в одном виде', async () => {
    renderCard();

    // Смысл всего гейта: номера нет в разметке, пока его не запросили явно.
    // Иначе он уезжает в HTML и снимается одним `curl`.
    expect(document.body.textContent).not.toContain('+491701234567');
    expect(contacts.revealContacts).not.toHaveBeenCalled();
  });

  it('показывает контакты по явному нажатию', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: t.reveal }));

    await waitFor(() => expect(screen.getAllByText('+491701234567')).toHaveLength(2));
    expect(contacts.revealContacts).toHaveBeenCalledWith('gloria-berlin');
  });

  it('на исчерпанный лимит отвечает про ожидание, а не про сбой', async () => {
    contacts.revealContacts.mockRejectedValue(new contacts.RevealError(429));

    renderCard();
    await userEvent.click(screen.getByRole('button', { name: t.reveal }));

    // 429 говорит человеку о другом, чем обрыв сети: подождать, а не повторить.
    await waitFor(() => expect(screen.getByText(t.limit)).toBeTruthy());
  });

  it('на прочие отказы отвечает про сбой', async () => {
    contacts.revealContacts.mockRejectedValue(new Error('сеть недоступна'));

    renderCard();
    await userEvent.click(screen.getByRole('button', { name: t.reveal }));

    await waitFor(() => expect(screen.getByText(t.failed)).toBeTruthy());
  });
});

describe('маяк клика по контакту', () => {
  it('сообщает, по какому каналу ушли', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: t.reveal }));
    await waitFor(() => expect(screen.getAllByText('+491701234567')).toHaveLength(2));

    await userEvent.click(screen.getByText(t.whatsapp));

    // Раскрытие говорит, что номер увидели; клик — что по нему пошли.
    // Без типа владелица не узнает, звонят ей или пишут.
    expect(analytics.trackContactClick).toHaveBeenCalledWith('gloria-berlin', 'whatsapp');
  });

  it('не мешает переходу, когда маяк отказал', async () => {
    analytics.trackContactClick.mockRejectedValue(new Error('маяк не ушёл'));

    renderCard();
    await userEvent.click(screen.getByRole('button', { name: t.reveal }));
    await waitFor(() => expect(screen.getAllByText('+491701234567')).toHaveLength(2));

    // Сорванный `tel:` — настоящая потеря для владелицы анкеты, а несчитанный
    // клик — нет. Отказ маяка не должен доходить до обработчика нажатия.
    await expect(userEvent.click(screen.getByText(t.phone))).resolves.toBeUndefined();
  });

  it('ведёт телефон в набор, а мессенджер — в приложение', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: t.reveal }));
    await waitFor(() => expect(screen.getAllByText('+491701234567')).toHaveLength(2));

    const links = screen.getAllByRole('link');
    const phone = links.find((link) => link.getAttribute('href')?.startsWith('tel:'));
    const whatsapp = links.find((link) => link.getAttribute('href')?.includes('wa.me'));

    expect(phone).toBeTruthy();
    expect(whatsapp).toBeTruthy();
    // Мессенджер открывается новой вкладкой, и `rel` закрывает `window.opener`.
    expect(whatsapp?.getAttribute('target')).toBe('_blank');
    expect(whatsapp?.getAttribute('rel')).toContain('noreferrer');
    // Телефон — в том же окне: набор номера вкладку не открывает.
    expect(phone?.getAttribute('target')).toBeNull();
  });
});
