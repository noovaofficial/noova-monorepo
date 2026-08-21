'use client';

import { type ReactNode, useId, useState } from 'react';
import styles from './Section.module.css';

type Props = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

/** Сворачиваемый блок страницы анкеты. Контент всегда в DOM (только скрыт
 *  через CSS), чтобы он попадал в индекс и в поиск по странице. */
export function Section({ title, children, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={`${styles.card} ${open ? '' : styles.collapsed}`}>
      <button
        type="button"
        className={styles.head}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <h2 className={styles.title}>{title}</h2>
        <svg
          className={styles.chevron}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className={styles.body} id={bodyId}>
        {children}
      </div>
    </section>
  );
}
