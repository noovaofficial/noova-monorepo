'use client';

import { Button } from '@/design-system/components/Button';
import { resetConsent } from '@/layout/cookie-consent';

/**
 * «Изменить настройки cookie» на странице политики: стирает решение
 * и показывает баннер заново — то же право отозвать согласие, каким его
 * дали, никакого отдельного экрана «настройки» под простое да/нет заводить
 * не нужно.
 *
 * Подпись приходит пропом, а не через `useTranslations`: страница вокруг
 * серверная (`legal/cookies/page.tsx`), и заводить ради одной кнопки ещё
 * один клиентский неймспейс словаря не стоит той единственной строки,
 * которая тут нужна.
 */
export function ResetConsentButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" onClick={resetConsent}>
      {label}
    </Button>
  );
}
