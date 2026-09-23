'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { MenuIcon } from '@/layout/HeaderActions/icons';
import { SidebarLayout } from '@/layout/SidebarLayout';
import styles from '@/layout/SidebarLayout/SidebarLayout.module.css';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import { PromoCodeForm } from '@/modules/campaigns/components/PromoCodeForm';
import { Overlay } from '@/overlays/Overlay';
import { Link, usePathname } from '@/shared/i18n/navigation';
import dialogStyles from './AdvertiserLayout.module.css';

/**
 * Разделы рекламодателя: анкеты, компания (только у агентства — салон сам
 * анкета, индивидуалка размещает себя, посредника у них нет), подписка,
 * кошелёк, статистика. Список короткий, поэтому без заголовков групп —
 * они читались бы шумом там, где и без них всё на одном экране.
 *
 * Промокод — не переход на страницу, а модалка: раньше форма стояла в самом
 * низу «Подписки» и терялась среди тарифов, хотя это разовое действие ради
 * подарка, а не часть оформления оплаты. Пункт меню всегда на виду —
 * подставить код можно с любого экрана кабинета, а не только со «Подписки».
 */
export function AdvertiserLayout({ children }: { children: ReactNode }) {
  const ta = useTranslations('auth');
  const tf = useTranslations('filters');
  const { user } = useSession();
  const pathname = usePathname();
  const [promoOpen, setPromoOpen] = useState(false);

  const isIndividual = user?.advertiserKind === 'individual';
  const isItemActive = (href: string) => pathname === href;
  const itemClass = (href: string) =>
    `${styles.item} ${isItemActive(href) ? styles.itemActive : ''}`;

  const nav = (
    <nav className={styles.nav} aria-label={ta('accountMenu')}>
      {/* У индивидуалки анкета одна: вместо списка — сразу в её редактор. */}
      {isIndividual ? (
        <Link
          href="/account/profile"
          className={`${styles.item} ${pathname.startsWith('/account/profiles') ? styles.itemActive : ''}`}
        >
          <MenuIcon name="myProfiles" className={styles.itemIcon} />
          {ta('myProfile')}
        </Link>
      ) : (
        <Link href="/account/profiles" className={itemClass('/account/profiles')}>
          <MenuIcon name="myProfiles" className={styles.itemIcon} />
          {ta('myProfiles')}
        </Link>
      )}

      {user?.advertiserKind === 'agency' ? (
        <Link href="/account/company" className={itemClass('/account/company')}>
          <MenuIcon name="company" className={styles.itemIcon} />
          {ta('company')}
        </Link>
      ) : null}

      <Link href="/account/subscription" className={itemClass('/account/subscription')}>
        <MenuIcon name="subscription" className={styles.itemIcon} />
        {ta('subscription')}
      </Link>

      <Link href="/account/glowcoin" className={itemClass('/account/glowcoin')}>
        <GlowCoinIcon className={styles.itemIcon} size={19} />
        {ta('myGlowcoin')}
      </Link>

      <Link href="/account/analytics" className={itemClass('/account/analytics')}>
        <MenuIcon name="analytics" className={styles.itemIcon} />
        {ta('analytics')}
      </Link>

      <button type="button" className={styles.item} onClick={() => setPromoOpen(true)}>
        <MenuIcon name="promo" className={styles.itemIcon} />
        {ta('promo')}
      </button>
    </nav>
  );

  return (
    <>
      <SidebarLayout nav={nav}>{children}</SidebarLayout>

      {promoOpen ? (
        <Overlay onClose={() => setPromoOpen(false)}>
          <div
            className={dialogStyles.dialogWrap}
            role="dialog"
            aria-modal="true"
            aria-label={ta('promo')}
          >
            <button
              type="button"
              className={dialogStyles.dialogBackdrop}
              onClick={() => setPromoOpen(false)}
              aria-label={tf('close')}
            />
            <div className={dialogStyles.dialogCard}>
              <button
                type="button"
                className={dialogStyles.dialogClose}
                onClick={() => setPromoOpen(false)}
                aria-label={tf('close')}
              >
                ×
              </button>
              <PromoCodeForm />
            </div>
          </div>
        </Overlay>
      ) : null}
    </>
  );
}
