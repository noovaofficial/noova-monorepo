'use client';

import type { ContactType, ProfileContact } from '@noova/shared';
import { contactHref } from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { RevealError, revealCompanyContacts } from '@/modules/contacts/api';
import { ContactIcon } from '../ContactIcon';
import styles from '../ContactsCard/ContactsCard.module.css';

type Props = {
  slug: string;
  /** Какие способы связи есть. Значений здесь нет и быть не может. */
  types: ContactType[];
};

/**
 * То же самое, что `ContactsCard`, но для контактов агентства: свой маршрут
 * раскрытия (`/companies/:slug/contacts/reveal`, см. api/company/reveal.ts),
 * своя модель на сервере — параллельный компонент, а не параметризация,
 * ровно по той же причине, по которой параллелен маршрут. Стиль общий.
 */
export function CompanyContactsCard({ slug, types }: Props) {
  const t = useTranslations('contacts');
  const [contacts, setContacts] = useState<ProfileContact[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'limit' | 'failed' | null>(null);

  async function onReveal() {
    setPending(true);
    setError(null);
    try {
      const result = await revealCompanyContacts(slug);
      setContacts(result.contacts);
    } catch (cause) {
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
            target={contact.type === 'phone' ? undefined : '_blank'}
            rel="noreferrer nofollow"
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
