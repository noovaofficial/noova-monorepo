import {
  type ContactInput,
  cityOptionSchema,
  createProfileSchema,
  deleteAccountSchema,
  LISTING_KIND_BY_ADVERTISER,
  normalizeContact,
  ownProfileSchema,
  PROFILE_LIMIT_BY_ADVERTISER,
  type ServiceGroup,
  serviceGroupSchema,
  snapLocation,
  updateProfileSchema,
} from '@noova/shared';
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { localeQuerySchema, localized, translationSelect } from '../../i18n.js';
import { PROFILES_TAG, profileTag } from '../../plugins/revalidate.js';
import { requireSession } from '../../plugins/session.js';
import { verifyPassword } from '../auth/passwords.js';
import { toOwnPhoto } from '../photos/routes.js';
import { deletePhotoFiles } from '../photos/storage.js';
import { ownProfileSelect, toOwnProfile } from './mappers.js';

/**
 * Ссылки на фото подписываются на лету, поэтому сборка представления
 * асинхронная. Отдельная функция, чтобы не повторять это в шести маршрутах.
 */
async function present(row: Parameters<typeof toOwnProfile>[0]) {
  const photos = await Promise.all(row.photos.map(toOwnPhoto));
  return toOwnProfile(row, photos);
}

/**
 * Изменение анкеты затрагивает и её страницу, и листинги: смена имени, цены
 * или статуса видна на карточке. Поэтому сбрасываем оба тега разом.
 */
function tagsFor(slug: string): string[] {
  return [profileTag(slug), PROFILES_TAG];
}

import { buildUniqueSlug } from './slug.js';

/**
 * Проверка владения. Вызывается на каждом маршруте, где приходит id анкеты:
 * доверять идентификатору из запроса нельзя, иначе чужая анкета правится
 * по прямой ссылке. Несуществующая и чужая анкеты дают один и тот же 404 —
 * чтобы нельзя было перебором узнать, какие id существуют.
 */
async function ownedProfileOr404(fastify: FastifyInstance, userId: string, profileId: string) {
  const profile = await fastify.prisma.profile.findFirst({
    where: { id: profileId, ownerId: userId },
    select: { id: true, status: true, slug: true },
  });
  if (!profile) throw fastify.httpErrors.notFound('Анкета не найдена');
  return profile;
}

async function advertiserOr403(fastify: FastifyInstance, userId: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, advertiserKind: true, emailVerifiedAt: true },
  });
  if (!user || user.role !== 'advertiser' || !user.advertiserKind) {
    throw fastify.httpErrors.forbidden('Доступно только рекламодателям');
  }
  return { advertiserKind: user.advertiserKind, isEmailVerified: user.emailVerifiedAt !== null };
}

/** Минимальная цена денормализована: по ней идёт сортировка листинга без джойнов. */
function lowestPriceCents(
  prices: { incallCents: number | null; outcallCents: number | null }[],
): number | null {
  const values = prices
    .flatMap((p) => [p.incallCents, p.outcallCents])
    .filter((v): v is number => v !== null && v > 0);
  return values.length > 0 ? Math.min(...values) : null;
}

/**
 * Координаты анкеты следуют из выбранного района и ниоткуда больше.
 *
 * Владелица указывает район, а не точку на карте: адрес мы не спрашиваем,
 * не храним и не показываем (architecture.md §6). Центр района — самое
 * точное, что нам вообще положено знать. Следствие: у всех анкет одного
 * района координата одинаковая, и это нужное свойство, а не недоработка —
 * по карте нельзя отличить одну квартиру от другой.
 *
 * Без района падаем на центр города: показать «где-то в Берлине» честнее,
 * чем не показать ничего.
 */
async function centerFor(
  fastify: FastifyInstance,
  cityId: string,
  districtId: string | null,
): Promise<{ approxLat: number | null; approxLng: number | null }> {
  if (districtId) {
    const district = await fastify.prisma.district.findUnique({
      where: { id: districtId },
      select: { lat: true, lng: true },
    });
    if (district?.lat != null && district.lng != null) {
      return { approxLat: district.lat, approxLng: district.lng };
    }
  }

  const city = await fastify.prisma.city.findUnique({
    where: { id: cityId },
    select: { lat: true, lng: true },
  });
  return { approxLat: city?.lat ?? null, approxLng: city?.lng ?? null };
}

export const accountRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    '/cities',
    {
      schema: {
        tags: ['account'],
        querystring: localeQuerySchema,
        response: { 200: z.array(cityOptionSchema) },
      },
    },
    async (request) => {
      const { locale } = request.query;
      const cities = await fastify.prisma.city.findMany({
        // Отключённый город и район из выбора уходят, но остаются в базе:
        // на них ссылаются анкеты (N-32).
        // Отключённая страна прячет и свои города: держать в выборе город
        // страны, которую закрыли, значит открыть её обходным путём.
        where: { isActive: true, country: { isActive: true } },
        select: {
          slug: true,
          name: true,
          translations: translationSelect(locale),
          country: {
            select: { code: true, name: true, translations: translationSelect(locale) },
          },
          districts: {
            where: { isActive: true },
            select: { slug: true, name: true, translations: translationSelect(locale) },
          },
        },
      });

      // Сортируем после перевода, а не в запросе: порядок зависит от языка —
      // по-русски «Берлин» и «Вена» стоят иначе, чем «Berlin» и «Wien».
      const collator = new Intl.Collator(locale);
      return cities
        .map((city) => ({
          slug: city.slug,
          name: localized(city.translations, city.name),
          country: {
            code: city.country.code,
            name: localized(city.country.translations, city.country.name),
          },
          districts: city.districts
            .map((d) => ({ slug: d.slug, name: localized(d.translations, d.name) }))
            .sort((a, b) => collator.compare(a.name, b.name)),
        }))
        .sort((a, b) => collator.compare(a.name, b.name));
    },
  );

  fastify.get(
    '/services',
    {
      schema: {
        tags: ['account'],
        querystring: z
          .object({ kind: z.enum(['escort', 'massage']).optional() })
          .and(localeQuerySchema),
        response: { 200: z.array(serviceGroupSchema) },
      },
    },
    async (request) => {
      const { kind, locale } = request.query;
      const rows = await fastify.prisma.service.findMany({
        where: {
          isActive: true,
          // Пустой appliesTo означает «для всех видов анкет».
          ...(kind ? { OR: [{ appliesTo: { isEmpty: true } }, { appliesTo: { has: kind } }] } : {}),
        },
        orderBy: { position: 'asc' },
        select: { key: true, group: true, translations: translationSelect(locale) },
      });

      // Названия групп — отдельным запросом: групп семь, а услуг шесть
      // десятков, и тянуть перевод группы вместе с каждой услугой значило бы
      // повторить одну и ту же строку многократно.
      const groupNames = new Map(
        (
          await fastify.prisma.serviceGroupTranslation.findMany({
            where: { locale },
            select: { groupKey: true, name: true },
          })
        ).map((row) => [row.groupKey, row.name]),
      );

      // Группируем на сервере: порядок групп задаётся полем position и не
      // должен зависеть от того, как клиент разложит плоский список.
      const groups: ServiceGroup[] = [];
      for (const row of rows) {
        let bucket = groups.find((g) => g.group === row.group);
        if (!bucket) {
          bucket = { group: row.group, name: groupNames.get(row.group) ?? row.group, services: [] };
          groups.push(bucket);
        }
        bucket.services.push({
          key: row.key,
          group: row.group,
          name: localized(row.translations, row.key),
        });
      }
      return groups;
    },
  );

  fastify.get(
    '/me/profiles',
    {
      onRequest: fastify.requireAuth,
      schema: { tags: ['account'], response: { 200: z.array(ownProfileSchema) } },
    },
    async (request) => {
      const rows = await fastify.prisma.profile.findMany({
        where: { ownerId: requireSession(request).userId },
        orderBy: { createdAt: 'desc' },
        select: ownProfileSelect,
      });
      return Promise.all(rows.map(present));
    },
  );

  fastify.post(
    '/me/profiles',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        body: createProfileSchema,
        response: { 201: ownProfileSchema },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const { advertiserKind } = await advertiserOr403(fastify, userId);

      const limit = PROFILE_LIMIT_BY_ADVERTISER[advertiserKind];
      const existing = await fastify.prisma.profile.count({ where: { ownerId: userId } });
      if (existing >= limit) {
        throw fastify.httpErrors.conflict(
          advertiserKind === 'individual'
            ? 'У индивидуальной анкеты может быть только одна анкета'
            : 'Достигнут лимит анкет',
        );
      }

      const company = await fastify.prisma.company.findUnique({
        where: { ownerId: userId },
        select: { id: true },
      });

      const city = await fastify.prisma.city.findUnique({
        where: { slug: request.body.citySlug },
        select: { id: true, slug: true },
      });
      if (!city) throw fastify.httpErrors.badRequest('Город не найден');

      const district = request.body.districtSlug
        ? await fastify.prisma.district.findFirst({
            where: { slug: request.body.districtSlug, cityId: city.id },
            select: { id: true },
          })
        : null;

      const slug = await buildUniqueSlug(fastify.prisma, request.body.displayName, city.slug);

      const center = await centerFor(fastify, city.id, district?.id ?? null);

      const created = await fastify.prisma.profile.create({
        data: {
          slug,
          ...center,
          // Вид анкеты жёстко следует из типа владельца, из запроса не берётся.
          kind: LISTING_KIND_BY_ADVERTISER[advertiserKind],
          // Анкета агентства и салона сразу принадлежит их компании: заводить
          // её и отдельно привязывать — лишний шаг, который забывают, и
          // анкета остаётся без бейджа принадлежности.
          ...(company ? { companyId: company.id } : {}),
          status: 'draft',
          displayName: request.body.displayName,
          ownerId: userId,
          cityId: city.id,
          districtId: district?.id ?? null,
          verification: { create: { status: 'none' } },
        },
        select: ownProfileSelect,
      });

      return reply.status(201).send(await present(created));
    },
  );

  fastify.get(
    '/me/profiles/:id',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ownProfileSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      // Важен побочный эффект — 404 на чужой анкете, а не возвращённое значение.
      await ownedProfileOr404(fastify, userId, request.params.id);

      const row = await fastify.prisma.profile.findUniqueOrThrow({
        where: { id: request.params.id },
        select: ownProfileSelect,
      });
      return present(row);
    },
  );

  fastify.patch(
    '/me/profiles/:id',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        body: updateProfileSchema,
        response: { 200: ownProfileSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const { advertiserKind } = await advertiserOr403(fastify, userId);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);
      const body = request.body;

      let cityId: string | undefined;
      let districtId: string | null | undefined;

      if (body.citySlug) {
        const city = await fastify.prisma.city.findUnique({
          where: { slug: body.citySlug },
          select: { id: true },
        });
        if (!city) throw fastify.httpErrors.badRequest('Город не найден');
        cityId = city.id;
        // Смена города обнуляет район: старый принадлежит другому городу.
        districtId = null;
      }

      if (body.districtSlug !== undefined) {
        if (body.districtSlug === null) {
          districtId = null;
        } else {
          const target = cityId
            ? { cityId }
            : {
                city: {
                  profiles: { some: { id: request.params.id } },
                },
              };
          const district = await fastify.prisma.district.findFirst({
            where: { slug: body.districtSlug, ...target },
            select: { id: true },
          });
          if (!district) throw fastify.httpErrors.badRequest('Район не найден в этом городе');
          districtId = district.id;
        }
      }

      // Ключи услуг сверяем со справочником до транзакции: выдуманный ключ —
      // ошибка клиента, и проглатывать его молча нельзя.
      //
      // Но снятая с каталога услуга, уже привязанная к этой анкете, ошибкой
      // не является: справочник меняем мы, а не владелец, и он не должен
      // из-за этого терять возможность сохранить свою анкету. Такие ключи
      // принимаем, новые снятые — нет.
      let serviceIdByKey: Map<string, string> | null = null;
      // Салонные поля пишем только салону: у анкеты человека адреса и часов
      // работы быть не должно, а форма прошлого типа могла их прислать.
      const isSalon = advertiserKind === 'salon';
      if (isSalon && body.hours !== undefined) {
        await fastify.prisma.profileHours.deleteMany({ where: { profileId: owned.id } });
        if (body.hours.length > 0) {
          await fastify.prisma.profileHours.createMany({
            data: body.hours.map((h) => ({ ...h, profileId: owned.id })),
          });
        }
      }

      if (body.services) {
        const keys = [...new Set(body.services.map((s) => s.key))];
        const known = await fastify.prisma.service.findMany({
          where: {
            key: { in: keys },
            OR: [{ isActive: true }, { profiles: { some: { profileId: request.params.id } } }],
          },
          select: { id: true, key: true },
        });

        if (known.length !== keys.length) {
          const unknown = keys.filter((key) => !known.some((s) => s.key === key));
          throw fastify.httpErrors.badRequest(`Неизвестная услуга: ${unknown.join(', ')}`);
        }
        serviceIdByKey = new Map(known.map((s) => [s.key, s.id]));
      }

      // Нормализуем до транзакции и на сервере: клиент может подсказать
      // формат, но решает сервер — иначе «0170…» и «+49170…» лягут двумя
      // строками, и @@unique их не поймает. Ошибку называем полем, а не
      // общим «неверные данные»: владелица должна знать, какую строку править.
      type NormalizedContact = { type: ContactInput['type']; value: string; position: number };
      let contacts: NormalizedContact[] | null = null;
      if (body.contacts) {
        const normalized: NormalizedContact[] = [];
        for (const [index, raw] of body.contacts.entries()) {
          const result = normalizeContact(raw.type, raw.value);
          if (!result.ok) {
            throw fastify.httpErrors.badRequest(
              `Некорректный контакт (${raw.type}): ${raw.value} — ${result.reason}`,
            );
          }
          normalized.push({ type: raw.type, value: result.value, position: index });
        }

        // Два одинаковых номера после нормализации — не ошибка ввода, а
        // следствие разных записей одного номера. Молча схлопываем: падать
        // на этом значило бы наказывать за то, что мы же и привели к одному виду.
        const seen = new Set<string>();
        contacts = normalized.filter((c) => {
          const key = `${c.type}:${c.value}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      /**
       * Точка, поставленная владелицей, всегда огрубляется до сетки: точнее
       * ячейки в базу не попадает ничего. Проверять это на клиенте нечего —
       * запрос подделывается, и решает только сервер.
       */
      let manual: { approxLat: number; approxLng: number; hasManualLocation: true } | null = null;
      let clearManual = false;
      if (body.location !== undefined) {
        if (body.location === null) {
          // Сброс точки возвращает вывод координат из района.
          clearManual = true;
        } else {
          const snapped = snapLocation(body.location.lat, body.location.lng);
          if (!snapped) throw fastify.httpErrors.badRequest('Некорректные координаты');
          manual = { approxLat: snapped.lat, approxLng: snapped.lng, hasManualLocation: true };
        }
      }

      // Координаты пересчитываем, только когда место менялось и точка не
      // поставлена вручную: смена района не должна сдвигать выбранное место.
      let center: { approxLat: number | null; approxLng: number | null } | null = null;
      const placeChanged = cityId !== undefined || districtId !== undefined;
      if (placeChanged && manual === null) {
        const current = await fastify.prisma.profile.findUniqueOrThrow({
          where: { id: request.params.id },
          select: { cityId: true, districtId: true, hasManualLocation: true },
        });
        if (!current.hasManualLocation || clearManual) {
          center = await centerFor(
            fastify,
            cityId ?? current.cityId,
            districtId !== undefined ? districtId : current.districtId,
          );
        }
      } else if (clearManual) {
        const current = await fastify.prisma.profile.findUniqueOrThrow({
          where: { id: request.params.id },
          select: { cityId: true, districtId: true },
        });
        center = await centerFor(fastify, current.cityId, current.districtId);
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (body.services && serviceIdByKey) {
          await tx.profileService.deleteMany({ where: { profileId: request.params.id } });
          if (body.services.length > 0) {
            await tx.profileService.createMany({
              data: body.services.map((s) => ({
                profileId: request.params.id,
                // biome-ignore lint/style/noNonNullAssertion: ключи сверены со справочником выше
                serviceId: serviceIdByKey!.get(s.key)!,
                isExtra: s.isExtra,
              })),
            });
          }
        }

        if (contacts) {
          await tx.profileContact.deleteMany({ where: { profileId: request.params.id } });
          if (contacts.length > 0) {
            await tx.profileContact.createMany({
              data: contacts.map((c) => ({ ...c, profileId: request.params.id })),
            });
          }
        }

        if (body.prices) {
          await tx.priceSlot.deleteMany({ where: { profileId: request.params.id } });
          if (body.prices.length > 0) {
            await tx.priceSlot.createMany({
              data: body.prices.map((p) => ({ ...p, profileId: request.params.id })),
            });
          }
        }

        return tx.profile.update({
          where: { id: request.params.id },
          data: {
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(cityId !== undefined ? { cityId } : {}),
            ...(districtId !== undefined ? { districtId } : {}),
            // Смена города или района двигает точку, только если владелица
            // не поставила её сама.
            ...(center ?? {}),
            ...(manual ?? {}),
            ...(clearManual ? { hasManualLocation: false } : {}),
            ...(body.age !== undefined ? { age: body.age } : {}),
            ...(body.heightCm !== undefined ? { heightCm: body.heightCm } : {}),
            ...(body.weightKg !== undefined ? { weightKg: body.weightKg } : {}),
            ...(body.languages !== undefined ? { languages: body.languages } : {}),
            ...(body.hairColor !== undefined ? { hairColor: body.hairColor } : {}),
            ...(body.eyeColor !== undefined ? { eyeColor: body.eyeColor } : {}),
            ...(body.breastSize !== undefined ? { breastSize: body.breastSize } : {}),
            ...(body.breastType !== undefined ? { breastType: body.breastType } : {}),
            ...(body.bodyType !== undefined ? { bodyType: body.bodyType } : {}),
            ...(body.pubicHair !== undefined ? { pubicHair: body.pubicHair } : {}),
            ...(body.hasPiercing !== undefined ? { hasPiercing: body.hasPiercing } : {}),
            ...(body.hasTattoos !== undefined ? { hasTattoos: body.hasTattoos } : {}),
            ...(body.appearanceType !== undefined ? { appearanceType: body.appearanceType } : {}),
            ...(body.smoker !== undefined ? { smoker: body.smoker } : {}),
            ...(body.prices !== undefined ? { fromPriceCents: lowestPriceCents(body.prices) } : {}),
            // Салонные поля — только салону: анкета человека не заведение.
            ...(isSalon && body.address !== undefined ? { address: body.address } : {}),
            ...(isSalon && body.directions !== undefined ? { directions: body.directions } : {}),
            ...(isSalon && body.minSessionMinutes !== undefined
              ? { minSessionMinutes: body.minSessionMinutes }
              : {}),
            ...(isSalon && body.bookingPolicy !== undefined
              ? { bookingPolicy: body.bookingPolicy }
              : {}),
            ...(isSalon && body.payments !== undefined ? { payments: body.payments } : {}),
            ...(isSalon && body.amenities !== undefined ? { amenities: body.amenities } : {}),
          },
          select: ownProfileSelect,
        });
      });

      fastify.revalidate(tagsFor(owned.slug));
      return present(updated);
    },
  );

  fastify.post(
    '/me/profiles/:id/submit',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ownProfileSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const { isEmailVerified } = await advertiserOr403(fastify, userId);
      if (!isEmailVerified) {
        throw fastify.httpErrors.forbidden('Сначала подтвердите адрес электронной почты');
      }
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const verification = await fastify.prisma.verificationCase.findUnique({
        where: { profileId: owned.id },
        select: { status: true },
      });

      /**
       * Пройденную верификацию повторной отправкой не сбрасываем. Отправка
       * переводит заявку в `pending`, то есть уже проверенная владелица
       * теряла бы статус и возвращалась в очередь — нажав кнопку, которая
       * ей в этот момент не нужна вовсе: анкету остаётся только опубликовать.
       *
       * Заблокированная анкета — исключение: там повторная проверка и есть
       * смысл действия, а в очередь она попадает именно через `pending`.
       */
      if (verification?.status === 'verified' && owned.status !== 'banned') {
        throw fastify.httpErrors.conflict('Верификация уже пройдена, анкету можно публиковать');
      }

      // Заблокированная анкета отправляется на проверку наравне с черновиком:
      // это путь исправления. Публикация отсюда всё равно невозможна — она
      // требует решения модератора.
      const updated = await fastify.prisma.profile.update({
        where: { id: request.params.id },
        data: {
          status: 'pending_verification',
          moderationNote: null,
          verification: {
            upsert: {
              create: { status: 'pending', submittedAt: new Date() },
              update: { status: 'pending', submittedAt: new Date(), rejectionReason: null },
            },
          },
        },
        select: ownProfileSelect,
      });

      fastify.revalidate(tagsFor(owned.slug));
      return present(updated);
    },
  );

  fastify.post(
    '/me/profiles/:id/publish',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ownProfileSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const verification = await fastify.prisma.verificationCase.findUnique({
        where: { profileId: request.params.id },
        select: { status: true },
      });

      // Ключевое правило: без пройденной верификации анкета не публикуется.
      // Проверка стоит на сервере, а не только в интерфейсе — обойти нельзя.
      if (verification?.status !== 'verified') {
        throw fastify.httpErrors.forbidden('Публикация возможна только после верификации');
      }

      const updated = await fastify.prisma.profile.update({
        where: { id: request.params.id },
        data: { status: 'published', publishedAt: new Date(), isVerified: true },
        select: ownProfileSelect,
      });

      fastify.revalidate(tagsFor(owned.slug));
      return present(updated);
    },
  );

  /**
   * Удаление анкеты. Отдельно от удаления учётной записи: у салона анкет
   * несколько, и убрать одну, не потеряв остальные и сам аккаунт, —
   * обычное дело. Раньше единственным способом было удалить весь аккаунт.
   *
   * Пароль обязателен, как и при удалении учётки: действие необратимо,
   * и с угнанной сессией без подтверждения стирают чужой заработок.
   */
  fastify.delete(
    '/me/profiles/:id',
    {
      onRequest: fastify.requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 hour', allowList: () => false } },
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        body: deleteAccountSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const user = await fastify.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });
      const ok = await verifyPassword(user.passwordHash, request.body.password);
      if (!ok) throw fastify.httpErrors.unauthorized('Неверный пароль');

      const photos = await fastify.prisma.photo.findMany({
        where: { profileId: owned.id },
        select: { storageKey: true },
      });

      /**
       * Файлы удаляем до строк. `Photo` каскадится от `Profile`: удали
       * анкету первой — и ключи потеряны, а объекты останутся в хранилище
       * навсегда. Ошибка хранилища прерывает удаление: лучше не удалить
       * сейчас, чем оставить сиротские файлы под публичным префиксом.
       */
      for (const photo of photos) {
        await deletePhotoFiles(photo.storageKey);
      }

      await fastify.prisma.profile.delete({ where: { id: owned.id } });

      fastify.revalidate(tagsFor(owned.slug));
      return reply.status(204).send(null);
    },
  );

  fastify.post(
    '/me/profiles/:id/pause',
    {
      onRequest: fastify.requireAuth,
      schema: {
        tags: ['account'],
        params: z.object({ id: z.string().min(1) }),
        response: { 200: ownProfileSchema },
      },
    },
    async (request) => {
      const { userId } = requireSession(request);
      const owned = await ownedProfileOr404(fastify, userId, request.params.id);

      const updated = await fastify.prisma.profile.update({
        where: { id: request.params.id },
        data: { status: 'paused' },
        select: ownProfileSelect,
      });

      fastify.revalidate(tagsFor(owned.slug));
      return present(updated);
    },
  );
};
