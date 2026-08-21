'use client';

import styles from '../FilterPanel.module.css';

type Props = {
  title: string;
  options: readonly string[];
  selected: string[];
  translate: (key: string) => string;
  onToggle: (value: string) => void;
  onClear?: () => void;
  clearLabel: string;
};

/** Набор значений одного параметра. Внутри группы значения складываются
 *  через ИЛИ — это выбор из списка, а не пересечение. */
export function ChipGroup({
  title,
  options,
  selected,
  translate,
  onToggle,
  onClear,
  clearLabel,
}: Props) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.subTitle}>{title}</span>
        {selected.length > 0 && onClear ? (
          <button type="button" className={styles.clear} onClick={onClear}>
            {clearLabel}
          </button>
        ) : null}
      </div>

      <div className={styles.chips}>
        {options.map((value) => (
          <button
            key={value}
            type="button"
            className={`${styles.chip} ${selected.includes(value) ? styles.chipOn : ''}`}
            onClick={() => onToggle(value)}
            aria-pressed={selected.includes(value)}
          >
            {translate(value)}
          </button>
        ))}
      </div>
    </div>
  );
}
