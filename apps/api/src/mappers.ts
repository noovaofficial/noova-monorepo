import type { City, ListingKind, Money, Photo, ProfileCard, ProfileDetail } from '@noova/shared';
import { env } from './env.js';

/** Публичный URL картинки собирается на отдаче — ключ в БД остаётся нейтральным
 *  к домену, чтобы переезд на другой CDN не требовал миграции данных. */
export function mediaUrl(storageKey: string): string {
  return `${env.MEDIA_BASE_URL.replace(/\/$/, '')}/${storageKey.replace(/^\//, '')}`;
}

/**
 * `storageKey` указывает на папку с производными размерами, а не на файл.
 * Публично отдаём средний вариант: он же используется и в карточке, и в галерее.
 */
export function photoUrl(storageKey: string, variant: 'thumb' | 'card' | 'full' = 'card'): string {
  return mediaUrl(`${storageKey}/${variant}.webp`);
}

export function toMoney(cents: number | null): Money | null {
  return cents === null ? null : { amountCents: cents, currency: 'EUR' };
}

type PhotoRow = {
  id: string;
  storageKey: string;
  width: number;
  height: number;
  blurDataUrl: string | null;
  position: number;
};

export function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    url: photoUrl(row.storageKey),
    fullUrl: photoUrl(row.storageKey, 'full'),
    blurDataUrl: row.blurDataUrl,
    width: row.width,
    height: row.height,
    position: row.position,
  };
}

type CityRow = { slug: string; name: string; countryCode: string };

export function toCity(row: CityRow): City {
  return { slug: row.slug, name: row.name, countryCode: row.countryCode };
}

/** Онлайн — это «был активен последние 10 минут», отдельного флага в БД нет. */
const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export function isOnline(lastSeenAt: Date | null): boolean {
  return lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

type ProfileCardRow = {
  id: string;
  slug: string;
  kind: ListingKind;
  displayName: string;
  age: number | null;
  city: CityRow;
  district: { name: string } | null;
  photos: PhotoRow[];
  services?: { service: { key: string } }[];
  fromPriceCents: number | null;
  isVerified: boolean;
  isFeatured: boolean;
  lastSeenAt: Date | null;
};

export function toProfileCard(row: ProfileCardRow): ProfileCard {
  const cover = row.photos[0];
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    displayName: row.displayName,
    age: row.age,
    city: toCity(row.city),
    district: row.district?.name ?? null,
    coverPhoto: cover ? toPhoto(cover) : null,
    serviceKeys: (row.services ?? []).slice(0, 6).map((s) => s.service.key),
    fromPrice: toMoney(row.fromPriceCents),
    isVerified: row.isVerified,
    isFeatured: row.isFeatured,
    isOnline: isOnline(row.lastSeenAt),
  };
}

type ProfileDetailRow = Omit<ProfileCardRow, 'services'> & {
  status: ProfileDetail['status'];
  description: string;
  heightCm: number | null;
  weightKg: number | null;
  languages: string[];
  hairColor: ProfileDetail['params']['hairColor'];
  eyeColor: ProfileDetail['params']['eyeColor'];
  breastSize: ProfileDetail['params']['breastSize'];
  breastType: ProfileDetail['params']['breastType'];
  bodyType: ProfileDetail['params']['bodyType'];
  pubicHair: ProfileDetail['params']['pubicHair'];
  hasPiercing: boolean | null;
  hasTattoos: boolean | null;
  appearanceType: ProfileDetail['params']['appearanceType'];
  smoker: boolean | null;
  approxLat: number | null;
  approxLng: number | null;
  updatedAt: Date;
  prices: { durationMinutes: number; incallCents: number | null; outcallCents: number | null }[];
  services: { isExtra: boolean; service: { key: string; group: string } }[];
  verification: { reviewedAt: Date | null; status: string } | null;
  /** Только типы: значения контактов в это представление не выбираются вовсе. */
  contacts: { type: ProfileDetail['contactTypes'][number] }[];
};

export function toProfileDetail(row: ProfileDetailRow): ProfileDetail {
  return {
    ...toProfileCard(row),
    status: row.status,
    description: row.description,
    photos: row.photos.map(toPhoto),
    params: {
      age: row.age,
      heightCm: row.heightCm,
      weightKg: row.weightKg,
      languages: row.languages,
      hairColor: row.hairColor,
      eyeColor: row.eyeColor,
      breastSize: row.breastSize,
      breastType: row.breastType,
      bodyType: row.bodyType,
      pubicHair: row.pubicHair,
      hasPiercing: row.hasPiercing,
      hasTattoos: row.hasTattoos,
      appearanceType: row.appearanceType,
      smoker: row.smoker,
    },
    prices: row.prices.map((p) => ({
      durationMinutes: p.durationMinutes,
      incall: toMoney(p.incallCents),
      outcall: toMoney(p.outcallCents),
    })),
    services: row.services.map((s) => ({
      key: s.service.key,
      group: s.service.group,
      extra: s.isExtra,
    })),
    // Дубли убираем здесь: два номера WhatsApp дают одну строку в интерфейсе.
    contactTypes: [...new Set(row.contacts.map((c) => c.type))],
    approxLocation:
      row.approxLat !== null && row.approxLng !== null
        ? { lat: row.approxLat, lng: row.approxLng }
        : null,
    verifiedAt:
      row.verification?.status === 'verified' && row.verification.reviewedAt
        ? row.verification.reviewedAt.toISOString()
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
