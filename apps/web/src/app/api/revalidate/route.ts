import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const bodySchema = z.object({
  tags: z.array(z.string().min(1).max(120)).min(1).max(20),
});

const SECRET = process.env.REVALIDATE_SECRET ?? '';

/** Сравнение постоянного времени: обычное `===` протекает по таймингу. */
function isValidSecret(provided: string): boolean {
  if (!SECRET || provided.length !== SECRET.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(SECRET));
}

/**
 * Сброс кэша по событию. Дёргается бэкендом, когда данные изменились:
 * владелец правит анкету, публикует её, модератор одобряет фото.
 *
 * Без этого правки видны только после истечения `revalidate` — до десяти минут.
 * Владелец за это время успевает решить, что сайт сломан, и написать в поддержку.
 *
 * Маршрут лежит вне `[locale]` и исключён из proxy-матчера: языковой префикс
 * ему не нужен, а редирект сломал бы POST.
 */
export async function POST(request: NextRequest) {
  if (!SECRET) {
    // Молча ничего не делать нельзя: иначе неверная конфигурация выглядит
    // как рабочая, а кэш просто не сбрасывается.
    return NextResponse.json({ error: 'REVALIDATE_SECRET не задан' }, { status: 503 });
  }

  if (!isValidSecret(request.headers.get('x-revalidate-secret') ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
  }

  for (const tag of parsed.data.tags) {
    // В Next 16 у revalidateTag появился второй аргумент — профиль времени
    // жизни. `expire: 0` означает «просрочить немедленно»: смысл вызова
    // именно в том, чтобы следующий запрос пошёл за свежими данными.
    revalidateTag(tag, { expire: 0 });
  }

  return NextResponse.json({ ok: true, revalidated: parsed.data.tags });
}
