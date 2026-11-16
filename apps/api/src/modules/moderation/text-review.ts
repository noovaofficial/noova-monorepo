import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Проверка правок текста опубликованной анкеты — постфактум.
 *
 * Модератор одобряет анкету с одним именем и описанием, а владелец потом
 * может их поменять, и новый текст сразу виден посетителям. Возвращать анкету
 * на полную проверку из-за исправленной опечатки — значит убирать её из
 * каталога; поэтому правка применяется сразу, но попадает в очередь, и
 * модератор либо соглашается с ней, либо возвращает одобренный текст.
 */

type Text = { displayName: string; description: string };

/**
 * Текст анкеты уже одобрен, и она может оказаться в каталоге без новой
 * проверки: опубликована, снята владельцем или прошла проверку, но ещё не
 * опубликована (публикация требует только пройденной проверки, а не свежей).
 * Заблокированная анкета наружу не выйдет — её правки проверять незачем.
 */
export function isTextReviewed(status: string, verification: string | null | undefined): boolean {
  if (status === 'banned') return false;
  return status === 'published' || status === 'paused' || verification === 'verified';
}

export type TextReviewStep = 'none' | 'open' | 'keep' | 'close';

/**
 * Что делать с проверкой после сохранения анкеты.
 *
 * - `open`  — текст отошёл от одобренного, проверки ещё нет;
 * - `keep`  — проверка уже открыта, текст по-прежнему другой;
 * - `close` — владелец вернул одобренный текст сам, проверять нечего;
 * - `none`  — анкета ещё не одобрялась либо текст не менялся.
 *
 * Сравнение идёт с одобренным текстом, а не с предыдущим сохранением:
 * иначе серия мелких правок считалась бы каждая по отдельности.
 */
export function textReviewStep(
  reviewed: boolean,
  current: Text,
  next: Text,
  open: { previousDisplayName: string; previousDescription: string } | null,
): TextReviewStep {
  if (!reviewed) return 'none';
  const approved: Text = open
    ? { displayName: open.previousDisplayName, description: open.previousDescription }
    : current;
  const same =
    next.displayName === approved.displayName && next.description === approved.description;
  if (same) return open ? 'close' : 'none';
  return open ? 'keep' : 'open';
}

/**
 * Применяет шаг в транзакции сохранения анкеты. Вызывается до записи нового
 * текста: `current` — то, что лежит в базе сейчас.
 */
export async function trackTextEdit(
  tx: Prisma.TransactionClient,
  profileId: string,
  next: Partial<Text>,
): Promise<void> {
  if (next.displayName === undefined && next.description === undefined) return;
  const profile = await tx.profile.findUnique({
    where: { id: profileId },
    select: {
      status: true,
      displayName: true,
      description: true,
      textReview: { select: { previousDisplayName: true, previousDescription: true } },
      verification: { select: { status: true } },
    },
  });
  if (!profile) return;

  const step = textReviewStep(
    isTextReviewed(profile.status, profile.verification?.status),
    profile,
    {
      displayName: next.displayName ?? profile.displayName,
      description: next.description ?? profile.description,
    },
    profile.textReview,
  );
  if (step === 'open') {
    await tx.profileTextReview.create({
      data: {
        profileId,
        previousDisplayName: profile.displayName,
        previousDescription: profile.description,
      },
    });
  } else if (step === 'close') {
    await tx.profileTextReview.delete({ where: { profileId } });
  }
}

/** Условие «правка ждёт решения» — одно на счётчик и на очередь. */
export const pendingTextReviewWhere = {
  profile: { status: { not: 'banned' } },
} satisfies Prisma.ProfileTextReviewWhereInput;
