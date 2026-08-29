/**
 * Значки кнопок второй строки шапки.
 *
 * Вынесены отдельно, потому что рисуются дважды: в `HeaderFilters` и в
 * заглушке Suspense вокруг него. Разметка обязана совпадать — иначе на
 * телефоне, где подписи скрыты, заглушка была бы пустой рамкой, а после
 * гидрации в ней рывком появлялся бы значок.
 */

export function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  );
}

export function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" />
      <path d="M9 3v15M15 6v15" />
    </svg>
  );
}
