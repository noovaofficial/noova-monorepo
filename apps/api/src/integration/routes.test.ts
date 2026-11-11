/**
 * Интеграционные тесты маршрутов: настоящее приложение, настоящая база.
 *
 * Запускаются только при `TEST_DATABASE_URL` — это должна быть отдельная,
 * уже прогнанная миграциями база (данные в ней стираются!). Без переменной
 * набор пропускается, и обычный `vitest run` остаётся быстрым и не требует
 * ни Postgres, ни Redis.
 *
 *   createdb noova_test && DATABASE_URL=...noova_test pnpm db:deploy
 *   TEST_DATABASE_URL=postgresql://.../noova_test pnpm --filter @noova/api test
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testUrl = process.env.TEST_DATABASE_URL;

type Json = Record<string, unknown>;

describe.skipIf(!testUrl)('маршруты: место аккаунта, правила размещения, Premium', () => {
  let app: FastifyInstance;
  const cookies = new Map<string, string>();

  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    options: { body?: unknown; as?: string } = {},
  ) => {
    const response = await app.inject({
      method,
      url: `/api/v1${url}`,
      ...(options.body === undefined ? {} : { payload: options.body as object }),
      headers: options.as ? { cookie: cookies.get(options.as) ?? '' } : {},
    });
    return { status: response.statusCode, body: response.json() as Json, raw: response };
  };

  const signIn = async (email: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'correct-horse-battery' },
    });
    expect(response.statusCode).toBe(200);
    const header = response.headers['set-cookie'];
    const list = Array.isArray(header) ? header : [String(header)];
    cookies.set(email, list.map((c) => c.split(';')[0]).join('; '));
  };

  const register = (extra: Json) =>
    call('POST', '/auth/register', {
      body: {
        role: 'advertiser',
        password: 'correct-horse-battery',
        locale: 'ru',
        ...extra,
      },
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl as string;
    const { buildApp } = await import('../app.js');
    const { hashPassword } = await import('../modules/auth/passwords.js');
    app = await buildApp();
    await app.ready();

    const db = app.prisma;
    // Чистый лист: набор владеет этой базой целиком.
    await db.$executeRawUnsafe(
      'TRUNCATE "User", "Country", "City", "PlacementRule", "Listing", "BillingTransaction" RESTART IDENTITY CASCADE',
    );

    const de = await db.country.create({
      data: { code: 'DE', name: 'Germany', isDefault: true, isActive: true },
    });
    const nl = await db.country.create({
      data: { code: 'NL', name: 'Netherlands', isActive: true },
    });
    const pl = await db.country.create({
      data: { code: 'PL', name: 'Poland', isActive: true, currency: 'PLN' },
    });
    const city = (slug: string, countryId: string) =>
      db.city.create({ data: { slug, name: slug, countryId, lat: 1, lng: 1, isActive: true } });
    await city('berlin', de.id);
    await city('hamburg', de.id);
    await city('amsterdam', nl.id);
    await city('warszawa', pl.id);

    // В Нидерландах публикация индивидуалок закрыта.
    await db.placementRule.create({
      data: { countryId: nl.id, kind: 'individual', allowed: false },
    });

    const passwordHash = await hashPassword('correct-horse-battery');
    await db.user.create({
      data: {
        email: 'admin@test.dev',
        passwordHash,
        role: 'admin',
        emailVerifiedAt: new Date(),
        isAdult: true,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('регистрация рекламодателя', () => {
    it('в открытой стране создаёт аккаунт со страной и основным городом', async () => {
      const result = await register({
        email: 'ok@test.dev',
        advertiserKind: 'individual',
        countryCode: 'de',
        citySlug: 'berlin',
      });
      expect(result.status).toBe(200);

      const user = await app.prisma.user.findUniqueOrThrow({
        where: { email: 'ok@test.dev' },
        include: { country: true, city: true },
      });
      expect(user.country?.code).toBe('DE');
      expect(user.city?.slug).toBe('berlin');
    });

    it('в закрытой для типа стране не заводит аккаунт', async () => {
      const result = await register({
        email: 'closed@test.dev',
        advertiserKind: 'individual',
        countryCode: 'NL',
        citySlug: 'amsterdam',
      });
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('placement_forbidden');
      expect(await app.prisma.user.count({ where: { email: 'closed@test.dev' } })).toBe(0);
    });

    it('тот же город открыт другому типу: правило считается по типу', async () => {
      const result = await register({
        email: 'salon-nl@test.dev',
        advertiserKind: 'salon',
        countryCode: 'NL',
        citySlug: 'amsterdam',
      });
      expect(result.status).toBe(200);
    });

    it('индивидуалке и салону город обязателен, агентству нет', async () => {
      const missing = await register({
        email: 'nocity@test.dev',
        advertiserKind: 'individual',
        countryCode: 'DE',
      });
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('city_required');

      const agency = await register({
        email: 'agency@test.dev',
        advertiserKind: 'agency',
        countryCode: 'DE',
      });
      expect(agency.status).toBe(200);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { email: 'agency@test.dev' } });
      expect(user.cityId).toBeNull();
      expect(user.countryId).not.toBeNull();
    });

    it('город должен лежать в выбранной стране', async () => {
      const result = await register({
        email: 'mismatch@test.dev',
        advertiserKind: 'salon',
        countryCode: 'DE',
        citySlug: 'amsterdam',
      });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('city_not_found');
    });
  });

  describe('настройки: страна и город', () => {
    it('город меняется свободно в пределах страны', async () => {
      await signIn('ok@test.dev');
      const result = await call('PUT', '/me/location', {
        as: 'ok@test.dev',
        body: { countryCode: 'DE', citySlug: 'hamburg' },
      });
      expect(result.status).toBe(200);
      expect(result.body.citySlug).toBe('hamburg');
    });

    it('в закрытую страну перенести нельзя', async () => {
      const result = await call('PUT', '/me/location', {
        as: 'ok@test.dev',
        body: { countryCode: 'NL', citySlug: 'amsterdam' },
      });
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('placement_forbidden');
    });

    it('новая анкета берёт основной город, а чужую страну отвергает', async () => {
      const own = await call('POST', '/me/profiles', {
        as: 'ok@test.dev',
        body: { displayName: 'Anna' },
      });
      expect(own.status).toBe(201);

      // Лимит индивидуалки — одна анкета, поэтому чужую страну проверяем на
      // салоне ниже; здесь убеждаемся, что город взят основной.
      const profile = await app.prisma.profile.findFirstOrThrow({
        where: { owner: { email: 'ok@test.dev' } },
        include: { city: true },
      });
      expect(profile.city.slug).toBe('hamburg');
    });

    it('пока есть анкеты, страну сменить нельзя', async () => {
      const result = await call('PUT', '/me/location', {
        as: 'ok@test.dev',
        body: { countryCode: 'PL', citySlug: 'warszawa' },
      });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('location_has_profiles');
      await app.prisma.profile.updateMany({
        where: { owner: { email: 'ok@test.dev' } },
        data: { status: 'draft' },
      });
    });

    it('анкета в городе чужой страны не создаётся', async () => {
      await signIn('salon-nl@test.dev');
      const result = await call('POST', '/me/profiles', {
        as: 'salon-nl@test.dev',
        body: { displayName: 'Salon', citySlug: 'berlin' },
      });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('country_locked');
    });

    it('текущий пользователь отдаёт страну, город и язык писем', async () => {
      const me = await call('GET', '/auth/me', { as: 'ok@test.dev' });
      expect(me.body).toMatchObject({ countryCode: 'DE', citySlug: 'hamburg', locale: 'ru' });
    });

    it('язык писем следует за языком сайта', async () => {
      const result = await call('PUT', '/auth/locale', {
        as: 'ok@test.dev',
        body: { locale: 'en' },
      });
      expect(result.status).toBe(200);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { email: 'ok@test.dev' } });
      expect(user.locale).toBe('en');
    });
  });

  describe('админка: города и правила размещения', () => {
    it('город с анкетами в другую страну не переносится', async () => {
      await signIn('admin@test.dev');
      const [berlin, nl] = await Promise.all([
        app.prisma.city.findUniqueOrThrow({ where: { slug: 'hamburg' } }),
        app.prisma.country.findUniqueOrThrow({ where: { code: 'NL' } }),
      ]);
      const result = await call('PATCH', `/admin/cities/${berlin.id}`, {
        as: 'admin@test.dev',
        body: {
          name: {
            en: 'Hamburg',
            de: 'Hamburg',
            es: 'Hamburgo',
            fr: 'Hambourg',
            ru: 'Гамбург',
            pl: 'Hamburg',
          },
          countryId: nl.id,
          lat: 1,
          lng: 1,
          isActive: true,
        },
      });
      expect(result.status).toBe(409);
      expect(result.body.code).toBe('city_has_profiles');
    });

    it('агентства страны не показываются в чужой стране', async () => {
      const [de, nl] = await Promise.all([
        app.prisma.country.findUniqueOrThrow({ where: { code: 'DE' } }),
        app.prisma.country.findUniqueOrThrow({ where: { code: 'NL' } }),
      ]);
      const mk = async (email: string, slug: string, countryId: string) => {
        const owner = await app.prisma.user.create({
          data: { email, passwordHash: 'x', role: 'advertiser', advertiserKind: 'agency' },
        });
        await app.prisma.company.create({
          data: {
            slug,
            name: slug,
            kind: 'agency',
            ownerId: owner.id,
            countryId,
            // ТОП выдан вперёд публикации: анкет у агентства ещё нет.
            isFeatured: true,
          },
        });
      };
      await mk('geo-de@test.dev', 'geo-agency-de', de.id);
      await mk('geo-nl@test.dev', 'geo-agency-nl', nl.id);

      const inNl = await call('GET', '/companies?country=NL');
      const slugs = (inNl.body as unknown as { slug: string }[]).map((row) => row.slug);
      expect(slugs).toContain('geo-agency-nl');
      expect(slugs).not.toContain('geo-agency-de');
    });

    it('считает опубликованные анкеты типа и снимает их в паузу', async () => {
      const de = await app.prisma.country.findUniqueOrThrow({ where: { code: 'DE' } });
      await app.prisma.profile.updateMany({
        where: { owner: { email: 'ok@test.dev' } },
        data: { status: 'published' },
      });

      const count = await call(
        'GET',
        `/admin/placement-rules/published-count?countryId=${de.id}&kind=individual`,
        { as: 'admin@test.dev' },
      );
      expect(count.body.count).toBe(1);

      // Другой тип в той же стране не затрагивается.
      const other = await call(
        'GET',
        `/admin/placement-rules/published-count?countryId=${de.id}&kind=salon`,
        { as: 'admin@test.dev' },
      );
      expect(other.body.count).toBe(0);

      const paused = await call('POST', '/admin/placement-rules/pause-published', {
        as: 'admin@test.dev',
        body: { countryId: de.id, kind: 'individual' },
      });
      expect(paused.body.paused).toBe(1);
      const profile = await app.prisma.profile.findFirstOrThrow({
        where: { owner: { email: 'ok@test.dev' } },
      });
      expect(profile.status).toBe('paused');
    });
  });

  describe('подписка и Premium', () => {
    it('в платном месте правило «платно и разрешено»', async () => {
      const state = await call('GET', '/billing/placement', { as: 'ok@test.dev' });
      expect(state.body).toMatchObject({ paid: true, allowed: true, graceEndsAt: null });
    });

    it('в закрытой стране подписку не продают', async () => {
      await app.prisma.user.update({
        where: { email: 'salon-nl@test.dev' },
        data: { glowcoinBalance: 5000 },
      });
      // Салону в NL открыто, закроем правилом и проверим отказ.
      const nl = await app.prisma.country.findUniqueOrThrow({ where: { code: 'NL' } });
      await app.prisma.placementRule.create({
        data: { countryId: nl.id, kind: 'salon', allowed: false },
      });
      const result = await call('POST', '/billing/listings', {
        as: 'salon-nl@test.dev',
        body: { term: 'm1' },
      });
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('placement_forbidden');
    });

    it('в бесплатном месте подписка включает Premium, истечение выключает', async () => {
      const de = await app.prisma.country.findUniqueOrThrow({ where: { code: 'DE' } });
      await signIn('admin@test.dev');
      const rule = await call('PUT', '/admin/placement-rules', {
        as: 'admin@test.dev',
        body: { countryId: de.id, kind: 'individual', paid: false, allowed: true },
      });
      expect(rule.status).toBe(200);

      const state = await call('GET', '/billing/placement', { as: 'ok@test.dev' });
      expect(state.body).toMatchObject({ paid: false, allowed: true, graceEndsAt: null });

      const before = await app.prisma.profile.findFirstOrThrow({
        where: { owner: { email: 'ok@test.dev' } },
      });
      expect(before.isPremium).toBe(false);

      await app.prisma.user.update({
        where: { email: 'ok@test.dev' },
        data: { glowcoinBalance: 5000 },
      });
      const bought = await call('POST', '/billing/listings', {
        as: 'ok@test.dev',
        body: { term: 'm1' },
      });
      expect(bought.status).toBe(200);

      const premium = await app.prisma.profile.findFirstOrThrow({
        where: { owner: { email: 'ok@test.dev' } },
      });
      expect(premium.isPremium).toBe(true);

      // Правило снова «платно»: Premium пропадает, как и смысл подписки-буста.
      await call('PUT', '/admin/placement-rules', {
        as: 'admin@test.dev',
        body: { countryId: de.id, kind: 'individual', paid: true, allowed: true },
      });
      const after = await app.prisma.profile.findFirstOrThrow({
        where: { owner: { email: 'ok@test.dev' } },
      });
      expect(after.isPremium).toBe(false);
    });
  });

  describe('льготный срок: бесплатно → платно', () => {
    const setRule = async (
      countryId: string,
      paid: boolean | null,
      allowed: boolean | null = true,
    ) =>
      call('PUT', '/admin/placement-rules', {
        as: 'admin@test.dev',
        body: { countryId, kind: 'individual', paid, allowed },
      });

    it('даёт срок владельцу без подписки, а потом снимает анкеты; оплата возвращает', async () => {
      const { enforcePlacementGrace } = await import('../modules/billing/placement-grace.js');
      const de = await app.prisma.country.findUniqueOrThrow({ where: { code: 'DE' } });

      expect(
        (
          await register({
            email: 'grace@test.dev',
            advertiserKind: 'individual',
            countryCode: 'DE',
            citySlug: 'berlin',
          })
        ).status,
      ).toBe(200);
      await signIn('grace@test.dev');

      // Место бесплатное: анкета публикуется без подписки.
      await setRule(de.id, false);
      const created = await call('POST', '/me/profiles', {
        as: 'grace@test.dev',
        body: { displayName: 'Greta' },
      });
      expect(created.status).toBe(201);
      await app.prisma.profile.updateMany({
        where: { owner: { email: 'grace@test.dev' } },
        data: { status: 'published' },
      });

      // Размещение стало платным: срок выдан, анкета пока в каталоге.
      await setRule(de.id, true);
      const owner = await app.prisma.user.findUniqueOrThrow({ where: { email: 'grace@test.dev' } });
      expect(owner.placementGraceEndsAt).not.toBeNull();
      expect(
        (await app.prisma.profile.findFirstOrThrow({ where: { ownerId: owner.id } })).status,
      ).toBe('published');

      const state = await call('GET', '/billing/placement', { as: 'grace@test.dev' });
      expect(state.body).toMatchObject({ paid: true, allowed: true });
      expect(state.body.graceEndsAt).toBe(owner.placementGraceEndsAt?.toISOString());

      // Срок не вышел — задача ничего не снимает.
      expect(await enforcePlacementGrace(app.prisma, { now: new Date() })).toBe(0);

      // Срок вышел — анкета снята с отметкой неоплаты.
      const later = new Date(owner.placementGraceEndsAt?.getTime() ?? 0 + 1000);
      later.setTime((owner.placementGraceEndsAt?.getTime() ?? 0) + 1000);
      expect(await enforcePlacementGrace(app.prisma, { now: later })).toBe(1);
      const paused = await app.prisma.profile.findFirstOrThrow({ where: { ownerId: owner.id } });
      expect(paused.status).toBe('paused');
      expect(paused.unpaidAt).not.toBeNull();
      expect(
        (await app.prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).placementGraceEndsAt,
      ).toBeNull();

      // Оплата возвращает анкету сама.
      await app.prisma.user.update({ where: { id: owner.id }, data: { glowcoinBalance: 5000 } });
      const bought = await call('POST', '/billing/listings', {
        as: 'grace@test.dev',
        body: { term: 'm1' },
      });
      expect(bought.status).toBe(200);
      expect(
        (await app.prisma.profile.findFirstOrThrow({ where: { ownerId: owner.id } })).status,
      ).toBe('published');
    });

    it('правка другого поля правила нового срока не даёт', async () => {
      const de = await app.prisma.country.findUniqueOrThrow({ where: { code: 'DE' } });
      // Заводим напрямую: регистрация и вход ограничены по частоте, а здесь
      // проверяется не они.
      const berlin = await app.prisma.city.findUniqueOrThrow({ where: { slug: 'berlin' } });
      const user = await app.prisma.user.create({
        data: {
          email: 'grace2@test.dev',
          passwordHash: 'x',
          role: 'advertiser',
          advertiserKind: 'individual',
          countryId: de.id,
          cityId: berlin.id,
        },
      });
      await app.prisma.profile.create({
        data: {
          slug: 'greta2-berlin',
          displayName: 'Greta2',
          ownerId: user.id,
          cityId: berlin.id,
          countryId: de.id,
          status: 'published',
        },
      });

      // Правило уже «платно»; меняем только допуск — льготы быть не должно.
      await setRule(de.id, true, true);
      const after = await app.prisma.user.findUniqueOrThrow({
        where: { email: 'grace2@test.dev' },
      });
      expect(after.placementGraceEndsAt).toBeNull();
    });

    it('возврат к бесплатному снимает льготу', async () => {
      const de = await app.prisma.country.findUniqueOrThrow({ where: { code: 'DE' } });
      await setRule(de.id, false);
      await app.prisma.user.update({
        where: { email: 'grace2@test.dev' },
        data: { placementGraceEndsAt: new Date(Date.now() + 86_400_000) },
      });
      await setRule(de.id, true);
      // Был платным → стал платным: не переход, льгота остаётся как была.
      await setRule(de.id, false);
      const user = await app.prisma.user.findUniqueOrThrow({ where: { email: 'grace2@test.dev' } });
      expect(user.placementGraceEndsAt).toBeNull();
    });
  });

  describe('смена страны с неопубликованными анкетами', () => {
    it('переводит анкеты в черновики новой страны и очищает цены', async () => {
      // grace@test.dev к этому моменту уже вошёл и владеет опубликованной анкетой.
      const owner = await app.prisma.user.findUniqueOrThrow({ where: { email: 'grace@test.dev' } });
      const profile = await app.prisma.profile.findFirstOrThrow({ where: { ownerId: owner.id } });
      await app.prisma.priceSlot.create({
        data: { profileId: profile.id, durationMinutes: 60, incallCents: 15000 },
      });
      await app.prisma.profile.update({
        where: { id: profile.id },
        data: { status: 'published', fromPriceCents: 15000 },
      });

      // Опубликованная анкета держит страну.
      const blocked = await call('PUT', '/me/location', {
        as: 'grace@test.dev',
        body: { countryCode: 'PL', citySlug: 'warszawa' },
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('location_has_profiles');

      // Снята с публикации — переезд разрешён.
      await app.prisma.profile.update({ where: { id: profile.id }, data: { status: 'paused' } });
      const moved = await call('PUT', '/me/location', {
        as: 'grace@test.dev',
        body: { countryCode: 'PL', citySlug: 'warszawa' },
      });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({
        countryCode: 'PL',
        citySlug: 'warszawa',
        convertedProfiles: 1,
      });

      const after = await app.prisma.profile.findUniqueOrThrow({
        where: { id: profile.id },
        include: { city: true, country: true, prices: true },
      });
      expect(after.status).toBe('draft');
      expect(after.country.code).toBe('PL');
      expect(after.city.slug).toBe('warszawa');
      expect(after.prices).toHaveLength(0);
      expect(after.fromPriceCents).toBeNull();
      expect(after.districtId).toBeNull();
    });

    it('без анкет страна меняется, как раньше, и ничего не конвертирует', async () => {
      await signIn('salon-nl@test.dev');
      const result = await call('PUT', '/me/location', {
        as: 'salon-nl@test.dev',
        body: { countryCode: 'DE', citySlug: 'berlin' },
      });
      expect(result.status).toBe(200);
      expect(result.body.convertedProfiles).toBe(0);
    });
  });
});
