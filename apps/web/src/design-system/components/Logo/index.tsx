type LogoProps = { size?: number; withWordmark?: boolean };

/** Логотип из documentation/prototypes/noova_logo_concept.svg. Цвета — через токены,
 *  поэтому знак сам подстраивается под светлую и тёмную тему. */
export function Logo({ size = 30, withWordmark = true }: LogoProps) {
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
        style={{ flex: 'none' }}
      >
        <path
          d="M50,82 C30,64 12,52 12,34 C12,20 24,12 36,16 C44,18 48,24 50,30 C52,24 56,18 64,16 C76,12 88,20 88,34 C88,52 70,64 50,82 Z"
          stroke="var(--primary)"
          strokeWidth="6"
        />
        <path
          d="M50,68 C42,60 42,52 50,42 C58,52 58,60 50,68 Z"
          stroke="var(--accent)"
          strokeWidth="6"
        />
      </svg>
      {withWordmark ? <span>noova</span> : null}
    </>
  );
}
