import { type NextRequest, NextResponse } from 'next/server';

/**
 * Прокси тайлов карты через собственный домен.
 *
 * Живёт под `/tiles`, а не под `/api`, и это не вкусовщина: на проде Caddy
 * отдаёт весь префикс `/api/*` контейнеру `api`, поэтому маршрут Next с таким
 * адресом снаружи недостижим — вместо плиток приходит 404 от Fastify. На деве
 * web слушают напрямую, и ошибка там не воспроизводится.
 *
 * Смысл не в кэше, а в приватности: обращаясь к чужому тайл-серверу напрямую,
 * браузер посетителя сообщает ему свой адрес, `Referer` со страницей анкеты и
 * заодно то, какой участок карты он смотрит. Для каталога 18+ это утечка
 * особой категории по ст. 9 GDPR — по сути «этот человек интересовался этой
 * анкетой». Через прокси наружу ходит сервер, а не посетитель.
 *
 * Адрес поставщика задаётся `MAP_TILE_URL` и наружу не публикуется. Пустое
 * значение отключает карту целиком — компонент тогда показывает текстовую
 * сноску, как было до N-14.
 */
const UPSTREAM = process.env.MAP_TILE_URL ?? '';

/** Заголовок обязателен по правилам большинства тайл-серверов. */
const USER_AGENT = process.env.MAP_TILE_USER_AGENT ?? 'Noova/1.0';

/** Границы значений: тайл вне их — либо ошибка, либо попытка перебора. */
const MAX_ZOOM = 19;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  if (!UPSTREAM) return new NextResponse(null, { status: 404 });

  const { z, x, y } = await params;
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y.replace(/\.(png|webp|jpg)$/, ''));

  // Проверяем сами, а не полагаемся на поставщика: без этого маршрут
  // превращается в открытый прокси к произвольному пути upstream.
  const limit = 2 ** zoom;
  const valid =
    Number.isInteger(zoom) &&
    zoom >= 0 &&
    zoom <= MAX_ZOOM &&
    Number.isInteger(tileX) &&
    Number.isInteger(tileY) &&
    tileX >= 0 &&
    tileX < limit &&
    tileY >= 0 &&
    tileY < limit;

  if (!valid) return new NextResponse(null, { status: 400 });

  const url = UPSTREAM.replace('{z}', String(zoom))
    .replace('{x}', String(tileX))
    .replace('{y}', String(tileY));

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      // Месяц, а не неделя. Политика OSMF требует кэшировать плитки не
      // меньше 7 дней, но это её минимум, а не наша цель: карта города за
      // месяц не меняется настолько, чтобы посетитель заметил, зато
      // исходящих запросов к тайл-серверу становится в разы меньше. Для
      // волонтёрского сервера это разница между «терпимо» и «поводом
      // отозвать доступ».
      next: { revalidate: 60 * 60 * 24 * 30 },
    });

    if (!response.ok) return new NextResponse(null, { status: 502 });

    return new NextResponse(response.body, {
      headers: {
        'content-type': response.headers.get('content-type') ?? 'image/png',
        // Кэш и у посетителя: повторный заход не должен снова дёргать
        // поставщика через нас. Срок тот же, что у серверного кэша.
        'cache-control': 'public, max-age=2592000, immutable',
      },
    });
  } catch {
    // Недоступный тайл-сервер не должен ронять страницу анкеты —
    // компонент покажет пустой квадрат и сноску.
    return new NextResponse(null, { status: 502 });
  }
}
