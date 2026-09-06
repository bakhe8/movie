'use client';

import { useRef, type KeyboardEvent } from 'react';
import type { Title } from '../lib/api';
import styles from './PosterSet.module.css';

type Lang = 'ar' | 'en';
export type PosterEntry = NonNullable<Title['posters']>[number];

const copy = {
  ar: { group: 'بوسترات الفيلم', item: (n: number, of: number) => `البوستر ${n} من ${of}` },
  en: { group: 'Film posters', item: (n: number, of: number) => `Poster ${n} of ${of}` },
};

/**
 * The film's own posters as a strip of thumbnails (POSTERS-MULTI P5,
 * direction ب, approved 2026-09-06). Each thumbnail is a labelled button;
 * the chosen one wears the accent ring, and the caller swaps its cover and
 * header poster to that image. Nothing here is gesture-only -- no swipe, no
 * rotation on its own -- and nothing is persisted: a film always opens on
 * its first poster, the same image as `posterUrl` (ADR-120).
 *
 * Renders nothing for fewer than two posters, so a single-poster film and
 * any response from before P3 look exactly as they did.
 */
export function PosterSet({
  lang,
  posters,
  selected,
  onSelect,
  className,
}: {
  lang: Lang;
  posters: PosterEntry[];
  selected: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const count = posters.length;
  if (count < 2) {
    return null;
  }
  const t = copy[lang];
  // Arrow keys walk the strip like a toolbar (focus only; Enter or Space on
  // a button chooses it, as on any button). The screen's direction decides
  // which arrow means "next": in Arabic the first poster sits at the right.
  const towardEnd = lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
  const towardStart = lang === 'ar' ? 'ArrowRight' : 'ArrowLeft';

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = buttons.current.findIndex((button) => button === document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === towardEnd) next = Math.min(count - 1, current + 1);
    else if (event.key === towardStart) next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else return;
    event.preventDefault();
    buttons.current[next]?.focus();
  }

  return (
    <div className={[styles.set, className].filter(Boolean).join(' ')} role="group" aria-label={t.group} onKeyDown={onKeyDown}>
      {posters.map((poster, index) => {
        const active = index === selected;
        return (
          <button
            key={poster.posterUrl}
            type="button"
            className={active ? `${styles.thumb} ${styles.selected}` : styles.thumb}
            aria-label={t.item(index + 1, count)}
            aria-pressed={active}
            onClick={() => onSelect(index)}
            ref={(element) => {
              buttons.current[index] = element;
            }}
          >
            {/* The same URL the header shows, so the browser fetches each image
                once; `no-referrer` for the reason given in Poster.tsx. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.image} src={poster.posterUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          </button>
        );
      })}
    </div>
  );
}
