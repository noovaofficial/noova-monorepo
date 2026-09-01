/**
 * Знак GlowCoin: монета с литерой G.
 *
 * Рисуется `currentColor`, цвет задаёт место вставки — в меню шапки монета
 * должна быть подписью, а не украшением, и золото там читалось бы как
 * уведомление. Декоративная: подпись всегда стоит рядом текстом.
 */
export function GlowCoinIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.16" />
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M14.9 9.9A3.6 3.6 0 1 0 15.4 13.4H12.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
