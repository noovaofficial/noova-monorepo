import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';

export const alt = 'Noova';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = { params: Promise<{ locale: string }> };

/**
 * Дефолтная OG-картинка для страниц без своего фото (главная, каталог,
 * карта, прайсинг, контакты). Анкеты и агентства используют свои
 * фото/лого и эту картинку не показывают — next/og подставляет её только
 * там, где страница не задала `openGraph.images` сама.
 */
export default async function OpengraphImage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cityPicker' });
  const tagline = t('title');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#150e14',
        color: '#f6f1ef',
      }}
    >
      <svg width="120" height="120" viewBox="0 0 88 88" fill="none" role="img" aria-label="Noova">
        <path
          d="M44,82 C24,64 6,52 6,34 C6,20 18,12 30,16 C38,18 42,24 44,30 C46,24 50,18 58,16 C70,12 82,20 82,34 C82,52 64,64 44,82 Z"
          fill="#ec5a8b"
        />
      </svg>
      <div style={{ display: 'flex', marginTop: 28, fontSize: 96, fontWeight: 700 }}>Noova</div>
      <div style={{ display: 'flex', marginTop: 16, fontSize: 36, color: '#ff9a70' }}>
        {tagline}
      </div>
    </div>,
    { ...size },
  );
}
