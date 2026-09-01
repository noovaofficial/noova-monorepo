'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { useSession } from '@/modules/auth/components/SessionProvider';
import { GlowCoinIcon } from '@/modules/billing/components/GlowCoinIcon';
import { fetchQueueCount } from '@/modules/moderation/api';
import { isStaffRole, sectionsFor } from '@/modules/moderation/staff-sections';
import { Link, useRouter } from '@/shared/i18n/navigation';
import { queryKeys } from '@/shared/query-keys';
import styles from './HeaderActions.module.css';
import { MenuIcon } from './icons';

export function HeaderActions() {
  const t = useTranslations('nav');
  const ta = useTranslations('auth');
  const { user, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isStaff = isStaffRole(user?.role);

  // Счётчик очереди тянем только для персонала: остальным этот запрос вернул
  // бы 403 и зря шумел бы в консоли. Общий ключ с экраном модерации — после
  // решения там счётчик обновляется инвалидацией, без своего перезапроса.
  const { data: queue } = useQuery({
    queryKey: queryKeys.queueCount(),
    queryFn: fetchQueueCount,
    enabled: isStaff,
  });
  const queueCount = queue?.total ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function onSignOut() {
    setOpen(false);
    await signOut();
    router.push('/');
    router.refresh();
  }

  // Пока /auth/me не ответил, имени ещё нет — показываем нейтральную подпись,
  // чтобы кнопка не прыгала по ширине при подстановке никнейма.
  const label = user?.clientProfile?.nickname ?? user?.email ?? ta('account');
  const needsVerification = user !== null && !user.isEmailVerified;

  return (
    <>
      <div className={styles.anonymous}>
        {/* На телефоне остаётся одна кнопка из двух, и это «Войти».
            Места хватает ровно на одну, а вернуться в свою учётную запись
            нужно чаще, чем завести новую: регистрируются раз, входят
            постоянно. Путь к регистрации с телефона не пропадает — он есть
            на самой странице входа. */}
        <Link href="/login">
          <Button variant="secondary">{t('login')}</Button>
        </Link>
        <Link href="/register" className={styles.hideSm}>
          <Button variant="primary">{t('create')}</Button>
        </Link>
      </div>

      <div className={styles.authenticated} ref={wrapRef}>
        <button
          type="button"
          className={styles.trigger}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={ta('accountMenu')}
        >
          {queueCount > 0 ? (
            <span className={styles.queueDot}>{queueCount}</span>
          ) : needsVerification ? (
            <span className={styles.warnDot} />
          ) : null}
          <span className={styles.name}>{label}</span>
        </button>

        {open ? (
          <div className={styles.menu} role="menu">
            {needsVerification ? (
              <div className={styles.warning}>{ta('emailNotVerified')}</div>
            ) : null}

            {/* Один список на шапку и на меню — см. staff-sections.ts.
                Порядок и подписи обязаны совпадать: это одни и те же разделы. */}
            {sectionsFor(user?.role).map((section) => (
              <Link key={section.key} href={section.href} className={styles.item} role="menuitem">
                <MenuIcon name={section.key} className={styles.itemIcon} />
                {ta(section.key)}
                {section.key === 'moderation' && queueCount > 0 ? (
                  <span className={styles.queueBadge}>{queueCount}</span>
                ) : null}
              </Link>
            ))}

            {user?.role === 'advertiser' ? (
              <>
                <Link href="/account/profiles" className={styles.item} role="menuitem">
                  <MenuIcon name="myProfiles" className={styles.itemIcon} />
                  {ta('myProfiles')}
                </Link>
                {/* Кошелёк — рядом с анкетами, а не под настройками: анкета без
                    оплаченного срока не публикуется, и путь к пополнению должен
                    быть в одном движении с путём к анкетам. */}
                <Link href="/account/glowcoin" className={styles.item} role="menuitem">
                  <GlowCoinIcon className={styles.itemCoin} size={16} />
                  {ta('myGlowcoin')}
                </Link>
              </>
            ) : null}

            {user?.role === 'client' ? (
              <Link href="/account/favorites" className={styles.item} role="menuitem">
                <MenuIcon name="favorites" className={styles.itemIcon} />
                {ta('favorites')}
              </Link>
            ) : null}

            {/* Настройки — всем, кроме персонала: там удаление учётной
                записи, а сотрудников заводит и убирает администратор. */}
            {isStaff ? null : (
              <Link href="/account/settings" className={styles.item} role="menuitem">
                <MenuIcon name="settings" className={styles.itemIcon} />
                {ta('settings')}
              </Link>
            )}

            <div className={styles.separator} />
            <button type="button" className={styles.item} role="menuitem" onClick={onSignOut}>
              <MenuIcon name="logout" className={styles.itemIcon} />
              {ta('logout')}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
