import type { CampaignReward, RedeemError } from '@noova/shared';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { AdvertiserKind, CampaignTrigger } from '../../generated/prisma/enums.js';
import { applyMovement, toListing } from '../billing/wallet.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Кому подбираем акцию. Город берётся с анкеты — у учётной записи его нет. */
export type Candidate = {
  userId: string;
  advertiserKind: AdvertiserKind;
  /** Город первой анкеты. `null` — если акция по коду и анкеты ещё нет. */
  cityId: string | null;
};

export class RedeemFailed extends Error {
  constructor(readonly reason: RedeemError) {
    super(reason);
    this.name = 'RedeemFailed';
  }
}

/**
 * Условия акции, кроме квоты. Чистая функция — правило проверяется без базы,
 * и его видно целиком в одном месте.
 *
 * Пустое условие означает «любой»: акция без города действует везде, без
 * типа — на всех рекламодателей. Так «первые 50 в Берлине» и «всем салонам
 * до конца месяца» описываются одной записью.
 */
export function matchesCampaign(
  campaign: {
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    cityId: string | null;
    advertiserKind: AdvertiserKind | null;
  },
  candidate: Candidate,
  now: Date,
): boolean {
  if (!campaign.isActive) return false;
  if (campaign.startsAt && campaign.startsAt > now) return false;
  if (campaign.endsAt && campaign.endsAt <= now) return false;
  if (campaign.advertiserKind && campaign.advertiserKind !== candidate.advertiserKind) return false;
  // Город известен только с анкеты. Нет анкеты — акция с городом не подходит,
  // а акция без города подходит по-прежнему.
  if (campaign.cityId && campaign.cityId !== candidate.cityId) return false;
  return true;
}

/**
 * Выдача награды внутри уже открытой транзакции.
 *
 * Монеты идут обычным движением кошелька: награда по акции — это те же
 * GlowCoin, и заводить им отдельный путь мимо журнала нельзя (payments.md §8).
 * Дни — продлением размещения от более поздней из двух дат: сегодня или
 * конец текущего срока. Иначе акция, выданная за неделю до истечения,
 * съедала бы оплаченную неделю.
 */
async function grantReward(
  tx: Prisma.TransactionClient,
  campaign: {
    id: string;
    name: string;
    rewardGc: number;
    rewardListingDays: number;
  },
  candidate: Candidate,
  now: Date,
): Promise<CampaignReward> {
  // Запись выдачи первой: уникальная пара «акция + человек» — единственное,
  // что делает повторную выдачу невозможной, и упасть она должна до того,
  // как деньги ушли.
  await tx.campaignGrant.create({
    data: {
      campaignId: campaign.id,
      userId: candidate.userId,
      grantedGc: campaign.rewardGc,
      grantedDays: campaign.rewardListingDays,
    },
  });

  const note = `Акция: ${campaign.name}`;

  let balanceGc: number;
  if (campaign.rewardGc > 0) {
    const movement = await applyMovement(tx, {
      userId: candidate.userId,
      kind: 'ADJUSTMENT',
      gcAmount: campaign.rewardGc,
      note,
    });
    balanceGc = movement.balanceGc;
  } else {
    const user = await tx.user.findUnique({
      where: { id: candidate.userId },
      select: { glowcoinBalance: true },
    });
    balanceGc = user?.glowcoinBalance ?? 0;
  }

  let listingExpiresAt: string | null = null;
  if (campaign.rewardListingDays > 0) {
    const current = await tx.listing.findFirst({
      where: { userId: candidate.userId },
      orderBy: { createdAt: 'desc' },
    });
    const from =
      current && current.status === 'active' && current.expiresAt > now ? current.expiresAt : now;
    const expiresAt = new Date(from.getTime() + campaign.rewardListingDays * DAY_MS);

    const listing = current
      ? await tx.listing.update({
          where: { id: current.id },
          data: {
            status: 'active',
            expiresAt,
            // Срок обнуляем: подаренные дни — не покупка, и оставленный
            // прежний тариф врал бы в истории («куплен год»).
            term: null,
            reminderSentAt: null,
            ...(current.status === 'active' ? {} : { activatedAt: now }),
          },
        })
      : await tx.listing.create({
          data: {
            userId: candidate.userId,
            kind: candidate.advertiserKind,
            term: null,
            status: 'active',
            activatedAt: now,
            expiresAt,
          },
        });

    listingExpiresAt = toListing(listing).expiresAt;

    // Анкеты, снятые за неоплату, возвращаются: подаренные дни — такое же
    // оплаченное размещение, как купленное.
    await tx.profile.updateMany({
      where: { ownerId: candidate.userId, unpaidAt: { not: null } },
      data: { status: 'published', unpaidAt: null },
    });
  }

  return {
    campaignName: campaign.name,
    grantedGc: campaign.rewardGc,
    grantedDays: campaign.rewardListingDays,
    listingExpiresAt,
    balanceGc,
  };
}

const campaignSelect = {
  id: true,
  name: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  cityId: true,
  advertiserKind: true,
  quota: true,
  rewardGc: true,
  rewardListingDays: true,
} as const;

/**
 * Занимает место в квоте и выдаёт награду. Обе операции — в одной транзакции
 * под блокировкой строки акции.
 *
 * Блокировка обязательна: без неё два одновременных обращения прочитали бы
 * один и тот же счётчик, оба увидели бы «49 из 50» и оба прошли бы. Для
 * акции «первые 50» это не теоретическая гонка — она случается ровно там,
 * где акция работает, то есть на всплеске регистраций.
 */
async function claim(
  prisma: PrismaClient,
  campaignId: string,
  candidate: Candidate,
  now: Date,
): Promise<CampaignReward> {
  return prisma.$transaction(async (tx) => {
    // FOR UPDATE на строке акции: она и есть точка сериализации квоты.
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR UPDATE`;

    const campaign = await tx.campaign.findUnique({
      where: { id: campaignId },
      select: campaignSelect,
    });
    if (!campaign || !matchesCampaign(campaign, candidate, now)) {
      throw new RedeemFailed('notEligible');
    }

    if (campaign.quota !== null) {
      const used = await tx.campaignGrant.count({ where: { campaignId } });
      if (used >= campaign.quota) throw new RedeemFailed('exhausted');
    }

    const already = await tx.campaignGrant.findUnique({
      where: { campaignId_userId: { campaignId, userId: candidate.userId } },
      select: { id: true },
    });
    if (already) throw new RedeemFailed('alreadyGranted');

    return grantReward(tx, campaign, candidate, now);
  });
}

/**
 * Применение кода из кабинета.
 *
 * Несуществующий, выключенный и просроченный код отвечают одинаково: иначе
 * перебором было бы видно, какие коды существуют, и чужую акцию можно было
 * бы вычерпать до того, как о ней узнают те, кому она предназначалась.
 */
export async function redeemPromoCode(
  prisma: PrismaClient,
  code: string,
  candidate: Candidate,
  now: Date = new Date(),
): Promise<CampaignReward> {
  const campaign = await prisma.campaign.findUnique({
    where: { code },
    select: { id: true, trigger: true, isActive: true, startsAt: true, endsAt: true },
  });

  if (campaign?.trigger !== 'promo_code' || !campaign.isActive) {
    throw new RedeemFailed('unknown');
  }
  if (campaign.startsAt && campaign.startsAt > now) throw new RedeemFailed('unknown');
  if (campaign.endsAt && campaign.endsAt <= now) throw new RedeemFailed('unknown');

  return claim(prisma, campaign.id, candidate, now);
}

/**
 * Автоматическая выдача по первой проверенной анкете.
 *
 * Ошибку не пробрасывает и ничего не сообщает: вызывается из одобрения
 * анкеты модератором, и сорвавшаяся акция не повод отменить одобрение.
 * Возвращает выданное — вызывающему для журнала.
 */
export async function applyFirstProfileCampaign(
  prisma: PrismaClient,
  candidate: Candidate,
  now: Date = new Date(),
): Promise<CampaignReward | null> {
  const campaigns = await prisma.campaign.findMany({
    where: { trigger: 'first_profile' as CampaignTrigger, isActive: true },
    select: campaignSelect,
    // Точное условие важнее общего: акция для Берлина должна выиграть у
    // акции «для всех», иначе городская никогда не сработает.
    orderBy: [{ cityId: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
  });

  const matched = campaigns.find((campaign) => matchesCampaign(campaign, candidate, now));
  if (!matched) return null;

  try {
    return await claim(prisma, matched.id, candidate, now);
  } catch (error) {
    if (error instanceof RedeemFailed) return null;
    throw error;
  }
}
