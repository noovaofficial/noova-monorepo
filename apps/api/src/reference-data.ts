/**
 * Загрузка справочников: страны, города, районы, услуги.
 *
 * Данные лежат в `prisma/reference-data.json` и читаются **в рантайме**, а не
 * импортируются. Разница принципиальная: относительный импорт tsup вшивает
 * в бандл, и `dist/scripts/seed-reference.js` нёс бы копию справочника
 * внутри себя. Обновить его на сервере можно было бы только пересборкой
 * образа — а справочник меняется из админки и должен доезжать без выпуска.
 *
 * Путь берётся от рабочего каталога: и в контейнере (`WORKDIR
 * /app/apps/api`), и локально (`pnpm --filter @noova/api`) он один и тот же.
 * Переопределяется через `REFERENCE_DATA` — этим пользуется перенос на сервер.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { listingKindSchema, translatedSchema } from '@noova/shared';
import { z } from 'zod';

export const DEFAULT_REFERENCE_PATH = 'prisma/reference-data.json';

const districtSeedSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: translatedSchema,
  /** Центр района: из него собирается приблизительное место анкеты. */
  lat: z.number(),
  lng: z.number(),
  isActive: z.boolean(),
});

const citySeedSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: translatedSchema,
  countryCode: z.string().length(2),
  lat: z.number(),
  lng: z.number(),
  isActive: z.boolean(),
  /** Необязательны: город может не делиться на районы. */
  districts: z.array(districtSeedSchema),
});

const countrySeedSchema = z.object({
  id: z.string().min(1),
  code: z.string().length(2),
  name: translatedSchema,
  isActive: z.boolean(),
});

const serviceSeedSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  group: z.string().min(1),
  appliesTo: z.array(listingKindSchema),
  position: z.number().int(),
  isActive: z.boolean(),
  name: translatedSchema,
});

export const referenceDataSchema = z.object({
  countries: z.array(countrySeedSchema),
  cities: z.array(citySeedSchema),
  /** Порядок групп задаёт вид панели фильтров. */
  serviceGroups: z.array(z.object({ key: z.string().min(1), name: translatedSchema })),
  services: z.array(serviceSeedSchema),
});

export type ReferenceData = z.infer<typeof referenceDataSchema>;
export type CountrySeed = ReferenceData['countries'][number];
export type CitySeed = ReferenceData['cities'][number];
export type DistrictSeed = CitySeed['districts'][number];
export type ServiceSeed = ReferenceData['services'][number];

export function referencePath(): string {
  const custom = process.env.REFERENCE_DATA;
  if (!custom) return join(process.cwd(), DEFAULT_REFERENCE_PATH);
  return isAbsolute(custom) ? custom : join(process.cwd(), custom);
}

/**
 * Разбор строгий: неполный перевод или отсутствующее поле — ошибка данных.
 * Молчаливо пропустить их значит увезти дефект на прод, где он проявится
 * сырым ключом на экране у посетителя.
 */
export function loadReferenceData(path = referencePath()): ReferenceData {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `Не читается справочник ${path}. Задайте REFERENCE_DATA или запустите из apps/api.`,
    );
  }

  const parsed = referenceDataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Справочник ${path} повреждён: ${first?.path.join('.')} — ${first?.message}`);
  }
  return parsed.data;
}
