import { describe, expect, it } from 'vitest';
import { contactHref, isPhoneLike, maskContactValue, normalizeContact } from './contact';

describe('normalizeContact', () => {
  it('приводит немецкий национальный формат к E.164', () => {
    // Ведущий ноль — национальный префикс, в E.164 его заменяет код страны.
    expect(normalizeContact('phone', '0170 123 45 67')).toEqual({
      ok: true,
      value: '+491701234567',
    });
  });

  it('считает «00» тем же международным префиксом, что и «+»', () => {
    expect(normalizeContact('phone', '0049 170 1234567')).toEqual({
      ok: true,
      value: '+491701234567',
    });
  });

  it('сводит разные записи одного номера к одной строке', () => {
    // Ради этого нормализация и нужна: иначе @@unique пропустит дубль.
    const forms = ['+49 170 1234567', '+49-170-123-45-67', '0170 1234567', '00491701234567'];
    const values = forms.map((form) => normalizeContact('phone', form));
    expect(new Set(values.map((v) => (v.ok ? v.value : 'fail')))).toEqual(
      new Set(['+491701234567']),
    );
  });

  it('принимает номер без «+»: маска в форме всё равно его поставит', () => {
    // Раньше это был отказ «укажите код страны». Требование сняли: поле
    // ввода само гарантирует «+», а внутри номера формат не наша забота.
    expect(normalizeContact('phone', '1701234567')).toEqual({ ok: true, value: '+1701234567' });
  });

  it('не проверяет формат внутри номера', () => {
    // Разделители, скобки, необычная длина — всё это живые способы записи.
    expect(normalizeContact('phone', '+49 (170) 12-34-567')).toEqual({
      ok: true,
      value: '+491701234567',
    });
  });

  it('не ограничивает длину номера', () => {
    // Решение владельца продукта: короткие и длинные номера — тоже номера,
    // и представления о «правильной» длине в код не зашиваем.
    expect(normalizeContact('phone', '+123')).toEqual({ ok: true, value: '+123' });
    expect(normalizeContact('phone', `+${'9'.repeat(24)}`)).toEqual({
      ok: true,
      value: `+${'9'.repeat(24)}`,
    });
  });

  it('отказывает только когда цифр нет вовсе', () => {
    // Единственный оставшийся отказ: сохранять нечего.
    expect(normalizeContact('phone', '+')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeContact('phone', '  ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('принимает ник Telegram со ссылкой и без', () => {
    for (const form of [
      '@noova_demo',
      'noova_demo',
      't.me/noova_demo',
      'https://t.me/noova_demo/',
    ]) {
      expect(normalizeContact('telegram', form)).toEqual({ ok: true, value: '@noova_demo' });
    }
  });

  it('принимает номер в поле Telegram', () => {
    expect(normalizeContact('telegram', '0170 1234567')).toEqual({
      ok: true,
      value: '+491701234567',
    });
  });

  it('отказывает нику Telegram короче пяти знаков', () => {
    expect(normalizeContact('telegram', '@abc')).toEqual({ ok: false, reason: 'telegramUsername' });
  });
});

describe('contactHref', () => {
  it('убирает «+» для wa.me и оставляет для tel:', () => {
    // wa.me на «+» отвечает 404 — это не косметика.
    expect(contactHref('whatsapp', '+491701234567')).toBe('https://wa.me/491701234567');
    expect(contactHref('phone', '+491701234567')).toBe('tel:+491701234567');
  });

  it('ведёт в Telegram по нику без «@»', () => {
    expect(contactHref('telegram', '@noova_demo')).toBe('https://t.me/noova_demo');
  });

  it('ведёт в Telegram по номеру, если ника нет', () => {
    expect(contactHref('telegram', '+491701234567')).toBe('https://t.me/491701234567');
  });
});

describe('maskContactValue', () => {
  it('всегда возвращает ведущий «+» для номерных каналов', () => {
    for (const type of ['phone', 'whatsapp', 'viber'] as const) {
      expect(maskContactValue(type, '')).toBe('+');
      expect(maskContactValue(type, '491701234567')).toBe('+491701234567');
      // Второй «+» из вставленного значения не удваивается.
      expect(maskContactValue(type, '+49170')).toBe('+49170');
    }
  });

  it('оставляет разделители, но не пускает буквы в номер', () => {
    expect(maskContactValue('phone', '+49 (170) 123-45-67')).toBe('+49 (170) 123-45-67');
    expect(maskContactValue('phone', '+49abc170')).toBe('+49170');
  });

  it('ник Telegram не маскирует', () => {
    expect(maskContactValue('telegram', '@noova_demo')).toBe('@noova_demo');
    expect(maskContactValue('telegram', 't.me/noova_demo')).toBe('t.me/noova_demo');
  });
});

describe('isPhoneLike', () => {
  it('отличает номер от ника', () => {
    // По этому признаку решается, можно ли вообще построить ссылку:
    // wa.me и viber:// принимают только номер.
    expect(isPhoneLike('+49 170 1234567')).toBe(true);
    expect(isPhoneLike('@noova_demo')).toBe(false);
  });
});
