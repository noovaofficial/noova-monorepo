import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import styles from '@/modules/content/components/ContentPage/ContentPage.module.css';

type Props = { params: Promise<{ locale: string }> };

/** Контакты поддержки. Один источник правды на всю страницу. */
const CONTACTS = [
  {
    key: 'telegram',
    value: '@noovasupport',
    href: 'https://t.me/noovasupport',
    icon: 'M21.9 4.3 18.7 19c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.7 12.8l-4.7-1.5c-1-.3-1-1 .2-1.5l18.4-7.1c.8-.3 1.6.2 1.3 1.6Z',
  },
  {
    key: 'email',
    value: 'support@noova.cc',
    href: 'mailto:support@noova.cc',
    icon: 'M3 5h18v14H3V5Zm0 0 9 7 9-7',
  },
] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: {
      canonical: `/${locale}/contact`,
      languages: { de: '/de/contact', en: '/en/contact', ru: '/ru/contact' },
    },
  };
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'contact' });

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{t('title')}</h1>
      <p className={styles.lead}>{t('lead')}</p>

      <div className={styles.contacts}>
        {CONTACTS.map((contact) => (
          <a
            className={styles.contact}
            key={contact.key}
            href={contact.href}
            // Мессенджер открывается приложением или новой вкладкой;
            // rel закрывает доступ к window.opener.
            {...(contact.key === 'email' ? {} : { target: '_blank', rel: 'noreferrer' })}
          >
            <svg
              className={styles.contactIcon}
              viewBox="0 0 24 24"
              fill={contact.key === 'email' ? 'none' : 'currentColor'}
              stroke={contact.key === 'email' ? 'currentColor' : 'none'}
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d={contact.icon} />
            </svg>
            <span>
              <span className={styles.contactLabel}>{t(contact.key)}</span>
              <br />
              <span className={styles.contactValue}>{contact.value}</span>
            </span>
          </a>
        ))}
      </div>

      <section className={styles.section} style={{ marginTop: 'var(--space8)' }}>
        <h2 className={styles.sectionTitle}>{t('reportTitle')}</h2>
        <p className={styles.text}>{t('reportText')}</p>
      </section>
    </div>
  );
}
