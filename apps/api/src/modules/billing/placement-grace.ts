import type { AdvertiserKind } from '@noova/shared';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import type { Mail } from '../auth/mailer.js';
import { localeOf } from '../auth/mailer.js';
import { hasVisibleListing } from './listing.js';
import { listingExpiredMail, placementPaidMail } from './mails.js';
import { placementFor } from './placement.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Льготный срок при переходе размещения «бесплатно → платно».
 *
 * Люди публиковались бесплатно и ничего не менялось с их стороны, поэтому
 * снимать анкеты в момент смены правила нельзя. Владельцам без подписки даётся
 * `graceDays`: анкеты остаются в каталоге, приходит письмо, а по истечении
 * срока задача `enforcePlacementGrace` снимает их с публикации (с отметкой
 * неоплаты — после оплаты они вернутся сами).
 */

export type GraceNotify = (mail: Mail) => unknown;

const safely = async (notify: GraceNotify | undefined, mail: Mail) => {
  try {
    await notify?.(mail);
  } catch {
    // Почта недоступна — льгота и снятие важнее письма.
  }
};

/**
 * Включает льготу владельцам этого типа в стране, у которых есть опубликованные
 * анкеты, но нет подписки. Остальным (правило снова бесплатное или подписка
 * есть) льготу снимает. Возвращает, скольким её выдали.
 */
export async function startPlacementGrace(
  db: PrismaClient,
  scope: { countryId: string },
  kind: AdvertiserKind,
  options: { graceDays: number; grant?: boolean; now?: Date; notify?: GraceNotify },
): Promise<number> {
  const now = options.now ?? new Date();
  const endsAt = new Date(now.getTime() + options.graceDays * DAY_MS);

  const owners = await db.user.findMany({
    where: {
      advertiserKind: kind,
      profiles: { some: { countryId: scope.countryId, status: 'published' } },
    },
    select: { id: true, email: true, locale: true, placementGraceEndsAt: true },
  });

  let granted = 0;
  for (const owner of owners) {
    const placement = await placementFor(db, { countryId: scope.countryId, cityId: '' }, kind);
    const needs = placement.allowed && placement.paid && !(await hasVisibleListing(db, owner.id));

    if (!needs) {
      if (owner.placementGraceEndsAt) {
        await db.user.update({ where: { id: owner.id }, data: { placementGraceEndsAt: null } });
      }
      continue;
    }
    if (options.grant === false) continue;
    // Уже идущую льготу не продлеваем: повторная правка правила не должна
    // растягивать срок бесконечно.
    if (owner.placementGraceEndsAt) continue;

    await db.user.update({ where: { id: owner.id }, data: { placementGraceEndsAt: endsAt } });
    granted += 1;
    await safely(options.notify, {
      to: owner.email,
      ...placementPaidMail(localeOf(owner.locale), endsAt),
    });
  }
  return granted;
}

/**
 * Задача цикла: у кого льгота кончилась, а подписки так и нет — анкеты в
 * платных местах снимаются с публикации. Возвращает число снятых владельцев.
 */
export async function enforcePlacementGrace(
  prisma: PrismaClient,
  options: {
    now?: Date;
    notify?: GraceNotify;
    revalidate?: (tags: string[]) => void;
  } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await prisma.user.findMany({
    where: { placementGraceEndsAt: { not: null, lte: now } },
    select: { id: true, email: true, locale: true, advertiserKind: true },
  });

  let enforced = 0;
  for (const owner of due) {
    const slugs = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: owner.id }, data: { placementGraceEndsAt: null } });
      if (!owner.advertiserKind || (await hasVisibleListing(tx, owner.id))) return [] as string[];

      const published = await tx.profile.findMany({
        where: { ownerId: owner.id, status: 'published' },
        select: { id: true, slug: true, cityId: true, countryId: true },
      });
      const toPause: typeof published = [];
      for (const profile of published) {
        const placement = await placementFor(tx, profile, owner.advertiserKind);
        if (placement.allowed && placement.paid) toPause.push(profile);
      }
      if (toPause.length > 0) {
        await tx.profile.updateMany({
          where: { id: { in: toPause.map((p) => p.id) } },
          data: { status: 'paused', unpaidAt: now, isPremium: false },
        });
      }
      return toPause.map((p) => p.slug);
    });

    if (slugs.length > 0) {
      enforced += 1;
      options.revalidate?.([PROFILES_TAG, ...slugs.map(profileTag)]);
      await safely(options.notify, {
        to: owner.email,
        ...listingExpiredMail(localeOf(owner.locale)),
      });
    }
  }
  return enforced;
}
