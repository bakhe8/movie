'use client';

import { useId, type KeyboardEvent } from 'react';
import { APPEARANCES, useAppearance, type Appearance } from '../lib/appearance';
import styles from './AppearancePicker.module.css';

const labels = {
  ar: {
    title: 'المشهد على ذوقك',
    cinema: 'سينما', premiere: 'العرض الأول', montage: 'مونتاج',
    cinemaNote: 'أضواء وعمق', premiereNote: 'دفء ولمعة', montageNote: 'حيوية وخفة',
    idle: 'لمسة واحدة تغيّر الجو', saving: 'يُحفظ في ملفك…', saved: 'محفوظ في ملفك',
    local: 'محفوظ على جهازك', error: 'لم يُحفظ بعد', retry: 'إعادة الحفظ',
  },
  en: {
    title: 'Set the scene',
    cinema: 'Cinema', premiere: 'Premiere', montage: 'Montage',
    cinemaNote: 'Light & depth', premiereNote: 'Warm & luminous', montageNote: 'Bright & playful',
    idle: 'One tap, a different mood', saving: 'Saving to your profile…', saved: 'Saved to your profile',
    local: 'Saved on this device', error: 'Not saved yet', retry: 'Try saving again',
  },
};

export function AppearancePicker({ lang, compact = false, className }: { lang: 'ar' | 'en'; compact?: boolean; className?: string }) {
  const { appearance, selectAppearance, status } = useAppearance();
  const titleId = useId();
  const t = labels[lang];

  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, value: Appearance) {
    const forward = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    const backward = lang === 'ar' ? 'ArrowRight' : 'ArrowLeft';
    if (![forward, backward, 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = APPEARANCES.indexOf(value);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? APPEARANCES.length - 1
      : (index + (event.key === forward || event.key === 'ArrowDown' ? 1 : -1) + APPEARANCES.length) % APPEARANCES.length;
    const next = APPEARANCES[nextIndex];
    selectAppearance(next);
    const group = event.currentTarget.parentElement;
    (group?.querySelector(`[data-style="${next}"]`) as HTMLButtonElement | null)?.focus();
  }

  return (
    <section className={[styles.picker, compact ? styles.compact : '', className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.heading}>
        <h3 id={titleId}>{t.title}</h3>
        {!compact && <span aria-live="polite" className={styles.status}>{t[status]}</span>}
      </div>
      <div className={styles.options} role="radiogroup" aria-labelledby={titleId}>
        {APPEARANCES.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={appearance === value}
            aria-label={t[value]} tabIndex={appearance === value ? 0 : -1}
            className={`${styles.option} ${styles[value]}`} data-style={value}
            onClick={() => { if (appearance !== value || status === 'error') selectAppearance(value); }}
            onKeyDown={(event) => moveSelection(event, value)}>
            <span className={styles.scene} aria-hidden="true">
              <span className={styles.orbit} />
              <span className={styles.horizon} />
              <span className={styles.film}><i /><i /><i /></span>
              <span className={styles.sceneMark}>K</span>
            </span>
            <span className={styles.caption}>
              <span><strong>{t[value]}</strong>{!compact && <small>{t[`${value}Note`]}</small>}</span>
              <span className={styles.check} aria-hidden="true">{appearance === value ? '✓' : ''}</span>
            </span>
          </button>
        ))}
      </div>
      {status === 'error' && <button type="button" className={styles.retry} onClick={() => selectAppearance(appearance)}>{t.retry}</button>}
    </section>
  );
}
