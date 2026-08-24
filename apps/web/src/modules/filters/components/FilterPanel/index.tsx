'use client';

import {
  appearanceTypeSchema,
  bodyTypeSchema,
  breastSizeSchema,
  breastTypeSchema,
  cityFromPath,
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
import { usePathname, useRouter } from '@/shared/i18n/navigation';
import { ChipGroup } from '../ChipGroup';
import styles from '../FilterPanel.module.css';

type Props = {
  kind: ListingKind;
  catalog: ServiceGroup[];
  initial: string;
  onClose: () => void;
  /**
   * Куда применять фильтры.
   *
   * `live` — правки пишутся в текущий URL сразу, выдача под панелью
   * обновляется. Так работает на странице каталога.
   *
   * `navigate` — панель открыта не над выдачей (например, из шапки на
   * главной), менять текущий адрес бессмысленно. Фильтры копятся локально
   * и применяются переходом в каталог по кнопке «Показать».
   */
  mode?: 'live' | 'navigate';
  targetPath?: string;
};

/**
 * Панель фильтров. Всё состояние — в URL: правки применяются сразу, а кнопка
 * внизу лишь закрывает панель. Промежуточного «черновика» фильтров нет
 * намеренно — иначе адресная строка расходится с тем, что видит человек.
 */
export function FilterPanel({ kind, catalog, initial, onClose, mode = 'live', targetPath }: Props) {
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
  const pathname = usePathname();
  const [params, setParams] = useState(() => new URLSearchParams(initial));

  /** Пишем в URL через replace: история не должна распухать от каждого чипа. */
  const push = (next: URLSearchParams) => {
    setParams(next);
    if (mode !== 'live') return;
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const apply = () => {
    if (mode === 'live') {
      onClose();
      return;
    }
    const query = params.toString();
    // Город берём из текущего пути: каталог живёт под ним (N-32). Без города
    // адрес попал бы на заглушку `/catalog/...`, а та уводит редиректом —
    // и выбранные фильтры терялись бы по дороге.
    const city = cityFromPath(pathname);
    const target = targetPath ?? `${city ? `/${city}` : ''}/catalog/${kind}`;
    router.push(query ? `${target}?${query}` : target);
    onClose();
  };

  const toggle = (key: string, value: string) => push(toggleValue(params, key, value));
  const set = (key: string, value: string) => push(setValue(params, key, value || undefined));
  const clearKey = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    next.delete('page');
    push(next);
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
            {/* Цена первой: это первое, по чему отсеивают, и держать её
                за списком параметров внешности значит прятать главное. Дальше
                внешность, услуги, остальное. */}
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
            <Button variant="secondary" onClick={() => push(clearFilters(params))}>
              {t('reset')}
            </Button>
            <Button onClick={apply}>{t('apply')}</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
