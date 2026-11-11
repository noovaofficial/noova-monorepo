import type { AdvertiserKind, CurrentUser, Gender, UserRole } from '@noova/shared';
import { env } from '../../env.js';

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
  advertiserKind: AdvertiserKind | null;
  clientProfile: {
    nickname: string;
    name: string | null;
    birthYear: number | null;
    gender: Gender | null;
  } | null;
  deletionRequestedAt: Date | null;
  locale: string;
  country?: { code: string } | null;
  city?: { slug: string } | null;
};

/** Пароль, токены и служебные метки наружу не отдаются. */
export function toCurrentUser(user: UserRow): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    isEmailVerified: user.emailVerifiedAt !== null,
    advertiserKind: user.advertiserKind,
    locale: user.locale,
    countryCode: user.country?.code ?? null,
    citySlug: user.city?.slug ?? null,
    clientProfile: user.clientProfile
      ? {
          nickname: user.clientProfile.nickname,
          name: user.clientProfile.name,
          birthYear: user.clientProfile.birthYear,
          gender: user.clientProfile.gender,
        }
      : null,
    deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null,
    // Считаем на сервере: клиент не должен сам складывать дни, иначе срок
    // в интерфейсе и срок в чистке разойдутся.
    deletionEffectiveAt: user.deletionRequestedAt
      ? new Date(
          user.deletionRequestedAt.getTime() +
            env.ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null,
  };
}
