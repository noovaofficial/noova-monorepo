import { createHash } from 'node:crypto';
import type { ContactType } from '@noova/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../env.js';
import type { ProfileEventKind } from '../../generated/prisma/enums.js';

/**
 * Журнал событий не должен сам стать базой персональных данных: адрес
 * посетителя в нём лежит хэшем с общей солью. Соль постоянная, иначе
 * записи одного человека перестанут схлопываться и журнал потеряет смысл
 * как антифрод и как дедупликация просмотров; из-за этого хэш обратим
 * перебором адресов — поэтому строки живут ограниченный срок, а не вечно.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${env.IP_HASH_SALT}:${ip}`).digest('hex');
}

/**
 * Сколько один посетитель «стоит» одного просмотра. Полчаса — это одно
 * посещение: обновление страницы, возврат «назад» из галереи и вторая
 * вкладка внутри окна просмотром не считаются. Иначе владелица видела бы
 * в отчёте чужой интерес там, где был один человек, и принимала бы по
 * этой цифре решения о фотографиях и цене.
 */
const VIEW_WINDOW_SECONDS = 30 * 60;

/**
 * Клик по контакту схлопывается только в пределах минуты — ровно чтобы
 * погасить двойное срабатывание по ссылке. Повторная попытка дозвониться
 * через полчаса — это отдельное обращение, и прятать её от владелицы
 * нельзя: непринятые звонки как раз и видны такими повторами.
 */
const CLICK_WINDOW_SECONDS = 60;

/**
 * Кто именно попал в статистику. Сессии рекламодателя и персонала не
 * попадают: владелица, открывшая собственную анкету, и модератор на
 * проверке — не посетители, а их заходы в отчёте неотличимы от чужих.
 * Гость (сессии нет вовсе) считается: вход не требуется ни для просмотра
 * анкеты, ни для раскрытия контактов, и половина аудитории — это он.
 */
function isVisitor(request: FastifyRequest): boolean {
  return request.session === null || request.session.role === 'client';
}

/**
 * Ключ посетителя для дедупликации. Вошедший узнаётся по учётной записи —
 * иначе смена сети посреди сеанса давала бы второй просмотр; гость — по
 * хэшу адреса, другого признака у него нет.
 */
function visitorKey(request: FastifyRequest, ipHash: string): string {
  return request.session?.userId ?? ipHash;
}

/**
 * Не было ли такого же события от этого же посетителя только что.
 * Окно живёт в Redis, а не проверяется запросом к журналу: проверка по
 * таблице — это чтение перед каждой записью на самом горячем маршруте
 * каталога, а промах ключа стоит одной лишней строки.
 *
 * Недоступность Redis трактуем как «не было»: пропущенное событие
 * восстановить нечем, а лишняя строка в журнале безвредна.
 */
async function firstInWindow(
  fastify: FastifyInstance,
  key: string,
  seconds: number,
): Promise<boolean> {
  try {
    return (await fastify.redis.set(key, '1', 'EX', seconds, 'NX')) === 'OK';
  } catch (error) {
    fastify.log.warn({ err: error }, 'не удалось проверить окно дедупликации события');
    return true;
  }
}

type RecordOptions = {
  kind: ProfileEventKind;
  profileId: string;
  /** Только у `contact_click`: по какому каналу ушли. */
  contactType?: ContactType;
};

/**
 * Запись события анкеты. Сбой записи не роняет ответ: посетитель пришёл
 * за анкетой, а не за нашей статистикой, и потеря строки в журнале —
 * меньшее зло, чем пятисотка на странице.
 *
 * Исключение — раскрытие контактов: там журнал ещё и антифрод, а антифрод
 * с молча пропущенными обращениями бесполезен. Его ошибка идёт наверх и
 * отменяет выдачу контактов.
 *
 * Возвращает признак «записали»: понадобилось тестам и вызывающим, которым
 * важно отличить настоящее событие от схлопнутого повтора.
 */
export async function recordProfileEvent(
  fastify: FastifyInstance,
  request: FastifyRequest,
  { kind, profileId, contactType }: RecordOptions,
): Promise<boolean> {
  // Раскрытие пишется всегда и от кого угодно: это ещё и антифрод, а он
  // теряет смысл, если часть обращений в журнал не попадает. Владелец
  // и персонал отсеиваются на чтении статистики, а не здесь.
  if (kind !== 'contact_reveal' && !isVisitor(request)) return false;

  const ipHash = hashIp(request.ip);

  const window =
    kind === 'view' ? VIEW_WINDOW_SECONDS : kind === 'contact_click' ? CLICK_WINDOW_SECONDS : null;

  if (window !== null) {
    const key = `ev:${kind}:${profileId}:${contactType ?? '-'}:${visitorKey(request, ipHash)}`;
    if (!(await firstInWindow(fastify, key, window))) return false;
  }

  const write = fastify.prisma.profileEvent.create({
    data: {
      profileId,
      kind,
      contactType: contactType ?? null,
      // Сессия читается на каждом запросе и здесь просто может отсутствовать.
      userId: request.session?.userId ?? null,
      ipHash,
    },
  });

  if (kind === 'contact_reveal') {
    await write;
    return true;
  }

  try {
    await write;
    return true;
  } catch (error) {
    fastify.log.warn({ err: error, kind, profileId }, 'не удалось записать событие анкеты');
    return false;
  }
}
