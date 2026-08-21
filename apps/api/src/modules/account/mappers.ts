import type { OwnPhoto, OwnProfile } from '@noova/shared';
import { toMoney } from '../../mappers.js';

type OwnProfileRow = {
  id: string;
  slug: string;
  kind: OwnProfile['kind'];
  status: OwnProfile['status'];
  displayName: string;
  description: string;
  city: { slug: string; name: string };
  district: { slug: string; name: string } | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  languages: string[];
  hairColor: OwnProfile['hairColor'];
  eyeColor: OwnProfile['eyeColor'];
  breastSize: OwnProfile['breastSize'];
  breastType: OwnProfile['breastType'];
  bodyType: OwnProfile['bodyType'];
  pubicHair: OwnProfile['pubicHair'];
  hasPiercing: boolean | null;
  hasTattoos: boolean | null;
  appearanceType: OwnProfile['appearanceType'];
  smoker: boolean | null;
  tags: string[];
  approxLat: number | null;
  approxLng: number | null;
  hasManualLocation: boolean;
  fromPriceCents: number | null;
  moderationNote: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  prices: { durationMinutes: number; incallCents: number | null; outcallCents: number | null }[];
  services: { isExtra: boolean; service: { key: string } }[];
  contacts: { type: OwnProfile['contacts'][number]['type']; value: string }[];
  photos: {
    id: string;
    storageKey: string;
    width: number;
    height: number;
    blurDataUrl: string | null;
    position: number;
    isApproved: boolean;
    rejectedReason: string | null;
  }[];
  verification: { status: OwnProfile['verificationStatus'] } | null;
};

/**
 * Владелец видит больше публичного представления: черновики, причину отказа
 * модератора и статус верификации. Наружу это не отдаётся.
 */
export function toOwnProfile(row: OwnProfileRow, photos: OwnPhoto[]): OwnProfile {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    displayName: row.displayName,
    description: row.description,
    city: { slug: row.city.slug, name: row.city.name },
    district: row.district ? { slug: row.district.slug, name: row.district.name } : null,
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
    tags: row.tags,
    location:
      row.approxLat !== null && row.approxLng !== null
        ? { lat: row.approxLat, lng: row.approxLng }
        : null,
    hasManualLocation: row.hasManualLocation,
    fromPrice: toMoney(row.fromPriceCents),
    prices: row.prices.map((p) => ({
      durationMinutes: p.durationMinutes,
      incallCents: p.incallCents,
      outcallCents: p.outcallCents,
    })),
    services: row.services.map((s) => ({ key: s.service.key, isExtra: s.isExtra })),
    // Свои контакты владелица видит без гейта: он защищает от чужих сборщиков.
    contacts: row.contacts.map((c) => ({ type: c.type, value: c.value })),
    // Владельцу показываем и неодобренные фото — иначе он не поймёт,
    // что загруженный снимок ждёт модерации.
    photos,
    verificationStatus: row.verification?.status ?? 'none',
    moderationNote: row.moderationNote,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const ownProfileSelect = {
  id: true,
  slug: true,
  kind: true,
  status: true,
  displayName: true,
  description: true,
  age: true,
  heightCm: true,
  weightKg: true,
  languages: true,
  hairColor: true,
  eyeColor: true,
  breastSize: true,
  breastType: true,
  bodyType: true,
  pubicHair: true,
  hasPiercing: true,
  hasTattoos: true,
  appearanceType: true,
  smoker: true,
  tags: true,
  approxLat: true,
  approxLng: true,
  hasManualLocation: true,
  fromPriceCents: true,
  moderationNote: true,
  publishedAt: true,
  updatedAt: true,
  city: { select: { slug: true, name: true } },
  district: { select: { slug: true, name: true } },
  prices: {
    orderBy: { durationMinutes: 'asc' },
    select: { durationMinutes: true, incallCents: true, outcallCents: true },
  },
  services: { select: { isExtra: true, service: { select: { key: true } } } },
  contacts: { orderBy: { position: 'asc' }, select: { type: true, value: true } },
  photos: {
    where: { deletedAt: null },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      storageKey: true,
      width: true,
      height: true,
      blurDataUrl: true,
      position: true,
      isApproved: true,
      rejectedReason: true,
    },
  },
  verification: { select: { status: true } },
} as const;
