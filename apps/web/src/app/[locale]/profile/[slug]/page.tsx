import type { Locale } from '@noova/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/design-system/components/Badge';
import { AreaMap } from '@/modules/catalog/components/AreaMap';
import { Gallery } from '@/modules/catalog/components/Gallery';
import { ProfileGrid } from '@/modules/catalog/components/ProfileGrid';
import { Section } from '@/modules/catalog/components/Section';
import { SectionHead } from '@/modules/catalog/components/SectionHead';
import { CommentForm } from '@/modules/comments/components/CommentForm';
import { CommentList } from '@/modules/comments/components/CommentList';
import { ContactsCard } from '@/modules/contacts/components/ContactsCard';
import { FavoriteButton } from '@/modules/favorites/components/FavoriteButton';
import { ReportProfile } from '@/modules/reports/components/ReportProfile';
import { ApiError, fetchComments, fetchNearby, fetchProfile } from '@/shared/api';
import { durationKey, formatMoney } from '@/shared/format';
import styles from './page.module.css';

// ISR: страница анкеты редко меняется, но должна подхватывать правки без редеплоя.
export const revalidate = 600;
export const dynamicParams = true;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;

  try {
    const profile = await fetchProfile(slug, { revalidate });
    const tm = await getTranslations({ locale, namespace: 'meta' });
    const title = tm('profileTitle', { name: profile.displayName, city: profile.city.name });

    return {
      title,
      description: tm('profileDescription', {
        name: profile.displayName,
        city: profile.city.name,
      }),
      alternates: {
        canonical: `/${locale}/profile/${slug}`,
        languages: {
          de: `/de/profile/${slug}`,
          en: `/en/profile/${slug}`,
          ru: `/ru/profile/${slug}`,
        },
      },
      openGraph: {
        title,
        type: 'profile',
        images: profile.photos[0] ? [{ url: profile.photos[0].url }] : undefined,
      },
    };
  } catch {
    // Метаданные не должны ронять страницу — 404 отдаст сам компонент.
    return {};
  }
}

/** Возвращает null только для реального 404; остальные ошибки пробрасывает,
 *  чтобы недоступность API не выглядела как удалённая анкета. */
async function loadProfile(slug: string, cache: { revalidate: number }) {
  try {
    return await fetchProfile(slug, cache);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export default async function ProfilePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const cache = { revalidate };

  // notFound() бросает служебную ошибку Next, которую нельзя вызывать внутри
  // колбэка .catch() — там сигнал теряется и страница отдаётся с кодом 200.
  // Поэтому сначала получаем результат, и только потом решаем.
  const profile = await loadProfile(slug, cache);
  if (!profile) notFound();

  const [nearby, comments, t] = await Promise.all([
    fetchNearby(slug, 8, cache).catch(() => []),
    // Недоступность комментариев не должна ронять страницу анкеты.
    fetchComments(slug, cache).catch(() => []),
    getTranslations({ locale, namespace: 'profile' }),
  ]);
  const tc = await getTranslations({ locale, namespace: 'card' });
  const tsv = await getTranslations({ locale, namespace: 'services' });
  const tsg = await getTranslations({ locale, namespace: 'serviceGroups' });
  // Значения внешности лежат в БД ключами — подписи берём из словарей.
  const tHair = await getTranslations({ locale, namespace: 'hairColor' });
  const tEye = await getTranslations({ locale, namespace: 'eyeColor' });
  const tBust = await getTranslations({ locale, namespace: 'breastSize' });
  const tLook = await getTranslations({ locale, namespace: 'appearanceType' });
  const tLang = await getTranslations({ locale, namespace: 'languageNames' });

  /**
   * Услуги приходят упорядоченными по каталогу, поэтому группируем по первому
   * появлению: так порядок групп на странице совпадает с формой редактирования
   * и не зависит от того, что именно выбрала владелица.
   */
  const serviceGroups: { name: string; items: typeof profile.services }[] = [];
  for (const service of profile.services) {
    let bucket = serviceGroups.find((group) => group.name === service.group);
    if (!bucket) {
      bucket = { name: service.group, items: [] };
      serviceGroups.push(bucket);
    }
    bucket.items.push(service);
  }

  const paramRows = [
    profile.params.age !== null && [t('age'), String(profile.params.age)],
    profile.params.heightCm !== null && [t('height'), `${profile.params.heightCm} cm`],
    profile.params.weightKg !== null && [t('weight'), `${profile.params.weightKg} kg`],
    profile.params.languages.length > 0 && [
      t('languages'),
      // Языки лежат в БД кодами — тем же способом, что и остальные
      // справочные значения ниже, подставляем подписи из словаря. Код,
      // которого в словаре нет, показываем как есть: список языков может
      // пополниться раньше переводов, и «de» лучше пустого места.
      profile.params.languages.map((code) => (tLang.has(code) ? tLang(code) : code)).join(', '),
    ],
    profile.params.hairColor && [t('hairColor'), tHair(profile.params.hairColor)],
    profile.params.eyeColor && [t('eyeColor'), tEye(profile.params.eyeColor)],
    profile.params.breastSize && [t('breastSize'), tBust(profile.params.breastSize)],
    profile.params.appearanceType && [t('appearanceType'), tLook(profile.params.appearanceType)],
  ].filter((row): row is [string, string] => Array.isArray(row));

  // Schema.org: помогает поисковику понять, что страница — карточка предложения,
  // а не просто текст. Персональные данные сюда не попадают.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    name: profile.displayName,
    url: `/${locale}/profile/${profile.slug}`,
    areaServed: { '@type': 'City', name: profile.city.name },
    ...(profile.fromPrice
      ? {
          priceSpecification: {
            '@type': 'PriceSpecification',
            price: profile.fromPrice.amountCents / 100,
            priceCurrency: profile.fromPrice.currency,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD из провалидированных схемой данных, сериализуется JSON.stringify
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Имя, бейджи и город одной строкой во всю ширину: раньше они занимали
          три строки в правой колонке и отодвигали содержимое вниз. */}
      <header className={styles.header}>
        <h1 className={styles.headerName}>
          {profile.displayName}
          {profile.age ? `, ${profile.age}` : ''}
        </h1>

        <div className={styles.headerBadges}>
          {profile.isVerified ? <Badge variant="verified">✓ {tc('verified')}</Badge> : null}
          {profile.isFeatured ? <Badge variant="featured">★ {tc('featured')}</Badge> : null}
          {profile.isOnline ? <Badge>{tc('online')}</Badge> : null}
          <FavoriteButton profileId={profile.id} withLabel />
        </div>

        <span className={styles.headerCity}>
          {profile.city.name}
          {profile.district ? ` · ${profile.district}` : ''}
        </span>
      </header>

      <div className={styles.layout}>
        <div className={styles.gallerySticky}>
          <Gallery
            photos={profile.photos}
            alt={`${profile.displayName}, ${profile.city.name}`}
            seed={profile.id}
          />
        </div>

        <div>
          {/* Контакты первым блоком: ради них страницу и открывают.
              Значений здесь нет — компонент забирает их отдельным запросом. */}
          {profile.contactTypes.length > 0 ? (
            <Section title={t('contacts')}>
              <ContactsCard slug={profile.slug} types={profile.contactTypes} />
            </Section>
          ) : null}

          <Section title={t('prices')}>
            <div className={styles.prices}>
              {profile.prices.map((slot) => {
                const { key, count } = durationKey(slot.durationMinutes);
                return (
                  <div key={slot.durationMinutes} className={styles.priceCard}>
                    <div className={styles.priceDuration}>
                      {key === 'night' ? t('night') : t('hour', { count })}
                    </div>
                    {slot.incall ? (
                      <div className={styles.priceRow}>
                        <span>{t('incall')}</span>
                        <strong>{formatMoney(slot.incall, locale as Locale)}</strong>
                      </div>
                    ) : null}
                    {slot.outcall ? (
                      <div className={styles.priceRow}>
                        <span>{t('outcall')}</span>
                        <strong>{formatMoney(slot.outcall, locale as Locale)}</strong>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title={t('params')}>
            <div className={styles.params}>
              {paramRows.map(([key, value]) => (
                <div key={key} className={styles.param}>
                  <span className={styles.paramKey}>{key}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t('description')}>
            <p className={styles.description}>{profile.description}</p>
          </Section>

          {profile.services.length > 0 ? (
            <Section title={t('services')}>
              {serviceGroups.map((group) => (
                <div className={styles.serviceGroup} key={group.name}>
                  <div className={styles.serviceGroupTitle}>
                    {tsg.has(group.name) ? tsg(group.name) : group.name}
                  </div>
                  <div className={styles.services}>
                    {group.items.map((service) => (
                      <span key={service.key} className={styles.service}>
                        <span className={styles.check}>✓</span>
                        {tsv.has(service.key) ? tsv(service.key) : service.key}
                        {service.extra ? <span className={styles.extra}>{t('extra')}</span> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </Section>
          ) : null}

          {/* Отзывы после описания и услуг: сначала то, за чем пришли,
              потом чужое мнение. */}
          <Section title={t('comments')}>
            <CommentList locale={locale as Locale} comments={comments} />
            <CommentForm slug={profile.slug} />
          </Section>

          {/* Жалоба внизу страницы: она нужна редко, но найтись должна
              без поиска. Вход для неё не требуется. */}
          <Section title={t('reportSection')} defaultOpen={false}>
            <ReportProfile slug={profile.slug} />
          </Section>

          {profile.approxLocation ? (
            <Section title={t('map')} defaultOpen={false}>
              {/* Карта включается только когда задан тайл-сервер. Иначе
                  остаётся текстовая сноска — пустой серый прямоугольник
                  хуже честной строки. */}
              {process.env.MAP_TILE_URL ? (
                <AreaMap
                  lat={profile.approxLocation.lat}
                  lng={profile.approxLocation.lng}
                  note={t('approxLocationNote')}
                  attribution={t('mapAttribution')}
                />
              ) : (
                <p className={styles.mapNote}>{t('approxLocationNote')}</p>
              )}
            </Section>
          ) : null}
        </div>
      </div>

      {nearby.length > 0 ? (
        <section className={styles.nearby}>
          <SectionHead title={t('nearby')} />
          <ProfileGrid profiles={nearby} locale={locale as Locale} />
        </section>
      ) : null}
    </>
  );
}
