import type { ReactNode } from 'react';

/**
 * Иконки действий персонала: блокировка, ТОП, удаление, подтверждение почты.
 * Инлайн-SVG, как `ContactIcon`/`GlowCoinIcon` — набор маленький, наследует
 * цвет темы через `currentColor`, отдельной зависимости не стоит.
 */

type IconProps = { className?: string; size?: number };

function IconBase({ className, size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Замок закрыт — блокировка. */
export function BlockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="6" y="11" width="12" height="9" rx="1.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </IconBase>
  );
}

/** Замок приоткрыт — снятие блокировки. */
export function UnblockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="6" y="11" width="12" height="9" rx="1.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 6.3-2.1" />
    </IconBase>
  );
}

/** Звезда — место в ТОПе, тот же смысл, что у бейджа «★ featured» в каталоге. */
export function TopIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5 14.2 8l5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7 2.2-4.5Z" />
    </IconBase>
  );
}

/** Корзина — необратимое удаление. */
export function DeleteIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </IconBase>
  );
}

/** Галочка в круге — подтверждение почты вручную. */
export function VerifyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.3 2.2 4.7-4.8" />
    </IconBase>
  );
}
