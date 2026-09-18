'use client';

import {
  appearanceTypeSchema,
  bodyTypeSchema,
  breastSizeSchema,
  breastTypeSchema,
  type CityOption,
  eyeColorSchema,
  hairColorSchema,
  type ListingKind,
  pubicHairSchema,
  type ServiceGroup,
  SPOKEN_LANGUAGES,
} from '@noova/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/design-system/components/Button';
import { clearFilters, setValue, toggleValue } from '@/modules/filters/params';
import { Overlay } from '@/overlays/Overlay';
import { useRouter } from '@/shared/i18n/navigation';
import { ChipGroup } from '../ChipGroup';
import styles from '../FilterPanel.module.css';

type Props = {
  kind: ListingKind;
  catalog: ServiceGroup[];
  /**
   * Города текущей страны — для сужения среза «вся страна» до нескольких
   * конкретных городов (N-43). Непустой список включает группу «Города»;
   * пустой (в т.ч. когда уже выбран один конкретный город) — прячет её,
   * выбирать город из списка одного смысла не имеет.
   */
  countryCities?: CityOption[];
  initial: string;
  onClose: () => void;
  /**
   * Куда вести по кнопке «Показать». На каталоге и карте — это текущий
   * адрес (правки просто дописывают его query), с главной — адрес каталога
   * этого города/страны. Панель сама его не считает: у неё нет справочника
   * городов, чтобы отличить город от кода страны (N-42) — адрес обязан
   * посчитать и передать вызывающий компонент.
   */
  targetPath: string;
};

/**
 * Панель фильтров.
 *
 * Правки копятся в локальном состоянии, а не пишутся в URL по каждому
 * клику: применяются они разом, кнопкой «Показать» внизу. Раньше на
 * странице каталога чипы применялись сразу — удобно казалось для быстрой
 * правки, но на деле сбивало: человек ещё выбирает, а выдача под панелью
 * уже дёргается и то и дело пустеет на середине выбора.
 */
export function FilterPanel({
  kind,
  catalog,
  countryCities = [],
  initial,
  onClose,
  targetPath,
}: Props) {
  const t = useTranslations('filters');
  const tHair = useTranslations('hairColor');
  const tEye = useTranslations('eyeColor');
  const tBust = useTranslations('breastSize');
  const tBreast = useTranslations('breastType');
  const tBody = useTranslations('bodyType');
  const tPubic = useTranslations('pubicHair');
  const tLook = useTranslations('appearanceType');
  const tLang = useTranslations('languageNames');

  const router = useRouter();
  const [params, setParams] = useState(() => new URLSearchParams(initial));

  const apply = () => {
    const query = params.toString();
    router.push(query ? `${targetPath}?${query}` : targetPath);
    onClose();
  };

  const toggle = (key: string, value: string) => setParams(toggleValue(params, key, value));
  const set = (key: string, value: string) => setParams(setValue(params, key, value || undefined));
  const clearKey = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    next.delete('page');
    setParams(next);
  };

  const selected = (key: string) => params.getAll(key);

  const range = (label: string, minKey: string, maxKey: string) => (
    <div className={styles.range}>
      <div className={styles.field}>
        <span className={styles.label}>
          {label} — {t('from')}
        </span>
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          defaultValue={params.get(minKey) ?? ''}
          onBlur={(event) => set(minKey, event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label}>
          {label} — {t('to')}
        </span>
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          defaultValue={params.get(maxKey) ?? ''}
          onBlur={(event) => set(maxKey, event.target.value)}
        />
      </div>
    </div>
  );

  // Панель открывается из липкой шапки, а `position: sticky` создаёт контекст
  // наложения: без портала её `z-index` считался бы внутри шапки, и она
  // не смогла бы подняться выше содержимого страницы.
  return (
    <Overlay onClose={onClose}>
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('title')}>
        {/* Фон — настоящая кнопка, а не div с onClick: так закрытие мышью
            не требует обходить правила доступности. Из порядка табуляции
            убрана — для клавиатуры есть Escape и кнопка «Закрыть». */}
        <button
          type="button"
          className={styles.backdrop}
          onClick={onClose}
          aria-label={t('close')}
          tabIndex={-1}
        />

        <div className={styles.panel}>
          <div className={styles.head}>
            <span className={styles.title}>{t('title')}</span>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label={t('close')}
            >
              ×
            </button>
          </div>

          <div className={styles.body}>
            {/* Города — только в срезе «вся страна» (N-43): сужение до
                нескольких городов имеет смысл, только когда сейчас показаны
                все сразу. Идёт первым, наравне с ценой — это тоже вопрос
                «где», а не «какая». */}
            {countryCities.length > 0 ? (
              <ChipGroup
                title={t('cities')}
                options={countryCities.map((city) => city.slug)}
                selected={selected('cities')}
                translate={(slug) => countryCities.find((city) => city.slug === slug)?.name ?? slug}
                onToggle={(value) => toggle('cities', value)}
                onClear={() => clearKey('cities')}
                clearLabel={t('clearGroup')}
              />
            ) : null}

            {/* Цена следующая: это первое, по чему отсеивают среди
                параметров анкеты, и держать её за списком внешности значит
                прятать главное. Дальше внешность, услуги, остальное. */}
            <div className={styles.group}>
              <span className={styles.groupTitle}>{t('price')}</span>
              <div className={styles.range}>
                <div className={styles.field}>
                  <span className={styles.label}>{t('priceFrom')}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    defaultValue={
                      params.get('minPriceCents')
                        ? String(Number(params.get('minPriceCents')) / 100)
                        : ''
                    }
                    onBlur={(event) =>
                      set(
                        'minPriceCents',
                        event.target.value ? String(Number(event.target.value) * 100) : '',
                      )
                    }
                  />
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>{t('priceTo')}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    defaultValue={
                      params.get('maxPriceCents')
                        ? String(Number(params.get('maxPriceCents')) / 100)
                        : ''
                    }
                    onBlur={(event) =>
                      set(
                        'maxPriceCents',
                        event.target.value ? String(Number(event.target.value) * 100) : '',
                      )
                    }
                  />
                </div>
              </div>
            </div>

            {kind === 'escort' ? (
              <div className={styles.group}>
                <span className={styles.groupTitle}>{t('appearance')}</span>
                {range(t('ageRange'), 'ageMin', 'ageMax')}
                {range(t('heightRange'), 'heightMin', 'heightMax')}
                {range(t('weightRange'), 'weightMin', 'weightMax')}

                <ChipGroup
                  title={t('hairColor')}
                  options={hairColorSchema.options}
                  selected={selected('hairColor')}
                  translate={(key) => tHair(key)}
                  onToggle={(value) => toggle('hairColor', value)}
                  onClear={() => clearKey('hairColor')}
                  clearLabel={t('clearGroup')}
                />
                <ChipGroup
                  title={t('eyeColor')}
                  options={eyeColorSchema.options}
                  selected={selected('eyeColor')}
                  translate={(key) => tEye(key)}
                  onToggle={(value) => toggle('eyeColor', value)}
                  onClear={() => clearKey('eyeColor')}
                  clearLabel={t('clearGroup')}
                />
                <ChipGroup
                  title={t('bodyTypeLabel')}
                  options={bodyTypeSchema.options}
                  selected={selected('bodyType')}
                  translate={(key) => tBody(key)}
                  onToggle={(value) => toggle('bodyType', value)}
                  onClear={() => clearKey('bodyType')}
                  clearLabel={t('clearGroup')}
                />
                <ChipGroup
                  title={t('breastSize')}
                  options={breastSizeSchema.options}
                  selected={selected('breastSize')}
                  translate={(key) => tBust(key)}
                  onToggle={(value) => toggle('breastSize', value)}
                  onClear={() => clearKey('breastSize')}
                  clearLabel={t('clearGroup')}
                />
                <ChipGroup
                  title={t('breastTypeLabel')}
                  options={breastTypeSchema.options}
                  selected={selected('breastType')}
                  translate={(key) => tBreast(key)}
                  onToggle={(value) => toggle('breastType', value)}
                  onClear={() => clearKey('breastType')}
                  clearLabel={t('clearGroup')}
                />
                <ChipGroup
                  title={t('pubicHairLabel')}
                  options={pubicHairSchema.options}
                  selected={selected('pubicHair')}
                  translate={(key) => tPubic(key)}
                  onToggle={(value) => toggle('pubicHair', value)}
                  onClear={() => clearKey('pubicHair')}
                  clearLabel={t('clearGroup')}
                />
                <ChipGroup
                  title={t('appearanceType')}
                  options={appearanceTypeSchema.options}
                  selected={selected('appearanceType')}
                  translate={(key) => tLook(key)}
                  onToggle={(value) => toggle('appearanceType', value)}
                  onClear={() => clearKey('appearanceType')}
                  clearLabel={t('clearGroup')}
                />
              </div>
            ) : null}

            {catalog.map((group) => (
              <ChipGroup
                key={group.group}
                title={group.name}
                options={group.services.map((service) => service.key)}
                selected={selected('services')}
                translate={(key) =>
                  group.services.find((service) => service.key === key)?.name ?? key
                }
                onToggle={(value) => toggle('services', value)}
                clearLabel={t('clearGroup')}
              />
            ))}

            <ChipGroup
              title={t('languages')}
              options={SPOKEN_LANGUAGES}
              selected={selected('languages')}
              translate={(key) => tLang(key)}
              onToggle={(value) => toggle('languages', value)}
              onClear={() => clearKey('languages')}
              clearLabel={t('clearGroup')}
            />

            <div className={styles.group}>
              <span className={styles.groupTitle}>{t('availability')}</span>
              <div className={styles.chips}>
                {(['onlineOnly', 'verifiedOnly', 'withCommentsOnly'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.chip} ${params.get(key) === 'true' ? styles.chipOn : ''}`}
                    onClick={() => set(key, params.get(key) === 'true' ? '' : 'true')}
                    aria-pressed={params.get(key) === 'true'}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.foot}>
            <Button variant="secondary" onClick={() => setParams(clearFilters(params))}>
              {t('reset')}
            </Button>
            <Button onClick={apply}>{t('apply')}</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
