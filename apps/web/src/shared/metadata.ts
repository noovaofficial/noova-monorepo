/**
 * Общий Open Graph / Twitter блок — шаблон одинаковый на всех витринных
 * страницах. `generateMetadata` с явным `openGraph` отключает автоподстановку
 * next/og `opengraph-image.tsx` для этого сегмента, поэтому дефолтную
 * картинку передаём сюда сами, когда у страницы нет своего фото/лого.
 */
export function socialMeta(input: {
  title: string;
  description?: string;
  image?: string;
  locale?: string;
}) {
  const { title, description, locale } = input;
  const image = input.image ?? (locale ? `/${locale}/opengraph-image` : undefined);
  return {
    openGraph: {
      title,
      description,
      images: image ? [{ url: image, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: image ? ('summary_large_image' as const) : ('summary' as const),
      title,
      description,
    },
  };
}
