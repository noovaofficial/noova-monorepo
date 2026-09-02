import { pickTranslation, type Translated } from '@noova/shared';
import { useLocale } from 'next-intl';

/**
 * Название справочника на языке интерфейса — для админки услуг и географии.
 *
 * Раньше там стоял `name[DEFAULT_LOCALE]`, и админ на русском видел немецкие
 * названия, а переключение языка ничего не меняло: справочник переводится
 * полностью (N-35), брать всегда немецкий не было причины.
 */
export function useLabel(): (name: Translated) => string {
  const locale = useLocale();
  return (name) => pickTranslation(name, locale);
}
