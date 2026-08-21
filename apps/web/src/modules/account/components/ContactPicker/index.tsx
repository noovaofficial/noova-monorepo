'use client';

import type { ContactInput, ContactType } from '@noova/shared';
import { CONTACT_TYPES, MAX_CONTACTS_PER_PROFILE, maskContactValue } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { Button } from '@/design-system/components/Button';
import styles from '../Account.module.css';

type Props = {
  contacts: ContactInput[];
  onChange: (next: ContactInput[]) => void;
};

/**
 * Строки контактов. Значение остаётся в том виде, в каком его набрали:
 * приводит к E.164 сервер, и подменять текст под курсором по каждому нажатию
 * клавиши — верный способ сделать поле невозможным для ввода.
 */
export function ContactPicker({ contacts, onChange }: Props) {
  const t = useTranslations('account');
  const tc = useTranslations('contacts');

  const update = (index: number, patch: Partial<ContactInput>) => {
    onChange(contacts.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{t('contacts')}</h2>
      <span className={styles.hint}>{t('contactsHint')}</span>

      {contacts.map((contact, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: строки не переупорядочиваются, а значение может повторяться до нормализации
        <div className={styles.priceRow} key={index}>
          <div className={styles.field}>
            <span className={styles.label}>{t('contactType')}</span>
            <select
              className={styles.select}
              value={contact.type}
              onChange={(e) => {
                // Значение прогоняем через маску нового типа: номер, набранный
                // как телефон, при переключении на Telegram должен остаться,
                // а ник при переключении обратно — потерять буквы.
                const type = e.target.value as ContactType;
                update(index, { type, value: maskContactValue(type, contact.value) });
              }}
            >
              {CONTACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {tc(type)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('contactValue')}</span>
            <input
              className={styles.input}
              type="text"
              // Цифровая клавиатура на телефоне для номерных каналов; у ника
              // Telegram она была бы помехой.
              inputMode={contact.type === 'telegram' ? 'text' : 'tel'}
              autoComplete="off"
              maxLength={64}
              placeholder={contact.type === 'telegram' ? '@nickname' : '+49 170 1234567'}
              value={contact.value}
              onChange={(e) =>
                update(index, { value: maskContactValue(contact.type, e.target.value) })
              }
              // Пустое поле показывает «+» сразу: иначе неясно, что он нужен,
              // и владелица начнёт набирать номер с нуля или с кода.
              onFocus={(e) => {
                if (e.target.value === '')
                  update(index, { value: maskContactValue(contact.type, '') });
              }}
            />
          </div>

          <button
            type="button"
            className={styles.remove}
            onClick={() => onChange(contacts.filter((_, i) => i !== index))}
          >
            {t('removeContact')}
          </button>
        </div>
      ))}

      {contacts.length < MAX_CONTACTS_PER_PROFILE ? (
        <Button
          variant="secondary"
          onClick={() => onChange([...contacts, { type: 'phone', value: '' }])}
        >
          {t('addContact')}
        </Button>
      ) : null}
    </div>
  );
}
