'use client';

import type { ContactType, ProfileContact } from '@noova/shared';
import { contactHref } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { trackContactClick } from '@/modules/analytics/api';
import { RevealError, revealContacts } from '@/modules/contacts/api';
import { ContactIcon } from '../ContactIcon';
import styles from './ContactsCard.module.css';

type Props = {
  slug: string;
  /** Какие способы связи есть. Значений здесь нет и быть не может. */
  types: ContactType[];
};

/**
 * Контакты приходят только по нажатию, отдельным запросом. Компонент
 * клиентский именно поэтому: отрисуй его сервер со значениями — они попали бы
 * в HTML и в RSC-payload, и весь гейт свёлся бы к CSS, который снимается
 * одним `curl`.
 */
export function ContactsCard({ slug, types }: Props) {
  const t = useTranslations('contacts');
  const [contacts, setContacts] = useState<ProfileContact[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'limit' | 'failed' | null>(null);

  async function onReveal() {
    setPending(true);
    setError(null);
    try {
      const result = await revealContacts(slug);
      setContacts(result.contacts);
    } catch (cause) {
      // 429 говорит человеку о другом, чем сбой сети: подождать, а не повторить.
      setError(cause instanceof RevealError && cause.status === 429 ? 'limit' : 'failed');
    } finally {
      setPending(false);
    }
  }

  if (contacts) {
    return (
      <div className={styles.list}>
        {contacts.map((contact) => (
          <a
            className={`${styles.row} ${styles.rowLink}`}
            key={`${contact.type}:${contact.value}`}
            href={contactHref(contact.type, contact.value)}
            // Мессенджеры открываются приложением или новой вкладкой;
            // rel закрывает доступ к window.opener.
            target={contact.type === 'phone' ? undefined : '_blank'}
            rel="noreferrer nofollow"
            /* Клик по контакту — вторая ступень отклика: раскрытие говорит,
               что номер увидели, и только клик — что по нему пошли. Переход
               ничем не задерживается: маяк уходит с `keepalive` и об ошибке
               не сообщает, потому что помешать звонку он не вправе. */
            onClick={() => {
              void trackContactClick(slug, contact.type);
            }}
          >
            <ContactIcon className={styles.icon} type={contact.type} />
            <span className={styles.type}>{t(contact.type)}</span>
            <span className={styles.value}>{contact.value}</span>
          </a>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.list}>
        {types.map((type) => (
          <div className={styles.row} key={type}>
            <ContactIcon className={styles.icon} type={type} />
            <span className={styles.type}>{t(type)}</span>
            {/* Точки — не скрытое значение, а его отсутствие: сервер прислал
                один лишь тип. Длина взята постоянной, чтобы не выдавать
                формат номера. */}
            <span className={styles.masked}>+•• ••• ••••••</span>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <Button onClick={onReveal} disabled={pending}>
          {pending ? t('revealing') : t('reveal')}
        </Button>
      </div>

      {error ? <p className={styles.error}>{t(error === 'limit' ? 'limit' : 'failed')}</p> : null}

      <p className={styles.note}>{t('note')}</p>
    </div>
  );
}
