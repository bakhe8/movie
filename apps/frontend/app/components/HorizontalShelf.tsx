'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '../lib/format';
import styles from './HorizontalShelf.module.css';

interface HorizontalShelfProps {
  lang: 'ar' | 'en';
  label: string;
  expanded: boolean;
  className: string;
  children: ReactNode;
  footerAction?: ReactNode;
}

interface ShelfPosition {
  overflow: boolean;
  previous: boolean;
  next: boolean;
  first: number;
  last: number;
  count: number;
}

const tolerance = 2;
const initialPosition: ShelfPosition = {
  overflow: false, previous: false, next: false, first: 0, last: 0, count: 0,
};

function shelfBounds(list: HTMLOListElement) {
  const style = window.getComputedStyle(list);
  const bounds = list.getBoundingClientRect();
  const left = bounds.left + list.clientLeft;
  const right = left + list.clientWidth;
  const items = Array.from(list.children)
    .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
    .filter((item) => item.bounds.width > 0);

  return {
    items, left, right, rtl: style.direction === 'rtl',
    startLeft: left + (Number.parseFloat(style.scrollPaddingLeft) || 0),
    startRight: right - (Number.parseFloat(style.scrollPaddingRight) || 0),
  };
}

function readPosition(list: HTMLOListElement): ShelfPosition {
  const { items, left, right, rtl } = shelfBounds(list);
  const count = items.length;
  if (!count || list.clientWidth === 0) return initialPosition;
  const visible = items.flatMap(({ bounds }, index) =>
    Math.min(bounds.right, right) - Math.max(bounds.left, left) > tolerance ? [index] : []);
  const first = items[0].bounds;
  const last = items[count - 1].bounds;

  return {
    overflow: list.scrollWidth - list.clientWidth > tolerance,
    previous: rtl ? first.right > right + tolerance : first.left < left - tolerance,
    next: rtl ? last.left < left - tolerance : last.right > right + tolerance,
    first: visible.length ? visible[0] + 1 : 0,
    last: visible.length ? visible[visible.length - 1] + 1 : 0,
    count,
  };
}

/** A native scrolling list; its caller owns card sizing and the expanded layout. */
export function HorizontalShelf({ lang, label, expanded, className, children, footerAction }: HorizontalShelfProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const listId = useId();
  const [position, setPosition] = useState<ShelfPosition>(initialPosition);
  const showControls = !expanded && position.overflow;
  const rtl = lang === 'ar';

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const next = readPosition(list);
      setPosition((current) => Object.keys(next).every((key) =>
        next[key as keyof ShelfPosition] === current[key as keyof ShelfPosition]) ? current : next);
    };
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure);
    const observeItems = () => {
      resizeObserver?.disconnect();
      resizeObserver?.observe(list);
      Array.from(list.children).forEach((child) => resizeObserver?.observe(child));
      scheduleMeasure();
    };
    const mutationObserver = new MutationObserver(observeItems);
    mutationObserver.observe(list, { childList: true });
    observeItems();
    list.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      list.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [children, className, expanded, lang]);

  function move(direction: 'previous' | 'next') {
    const list = listRef.current;
    if (!list) return;
    const { items, left, right, rtl: listRtl, startLeft, startRight } = shelfBounds(list);
    // Physical bounds avoid the browser-specific RTL scrollLeft conventions.
    // A partly revealed next card is the next target, keeping the cue useful.
    const target = direction === 'next'
      ? items.find(({ bounds }) => listRtl ? bounds.left < left - tolerance : bounds.right > right + tolerance)
      : items.slice().reverse().find(({ bounds }) => listRtl ? bounds.right > right + tolerance : bounds.left < left - tolerance);
    if (!target) return;
    const delta = listRtl ? target.bounds.right - startRight : target.bounds.left - startLeft;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: delta, behavior: reducedMotion ? 'instant' : 'smooth' });
  }

  const first = formatNumber(position.first, lang);
  const last = formatNumber(position.last, lang);
  const count = formatNumber(position.count, lang);
  const range = position.first === position.last ? first : `${first}–${last}`;

  return (
    <div className={styles.shelf} dir={rtl ? 'rtl' : 'ltr'}>
      <ol ref={listRef} id={listId} className={className} aria-label={label} tabIndex={showControls ? 0 : undefined}>
        {children}
      </ol>
      {(showControls || footerAction) && (
        <div className={styles.footer} data-controls={showControls || undefined}>
          {showControls && (
            <div className={styles.hint}>
              <span>{rtl ? 'اسحب للمقارنة' : 'Swipe to compare'}</span>
              <span className={styles.range} aria-live="polite" aria-atomic="true">
                <span dir="ltr" aria-hidden="true">{range} / {count}</span>
                <span className={styles.srOnly}>
                  {rtl ? `المعروض ${range} من ${count}` : `Showing ${range} of ${count}`}
                </span>
              </span>
            </div>
          )}
          <div className={styles.actions}>
            {showControls && (
              <div className={styles.arrows} role="group" aria-label={rtl ? `تصفح ${label}` : `Browse ${label}`}>
                <button type="button" className={styles.arrow} disabled={!position.previous}
                  aria-controls={listId} aria-label={rtl ? `السابق في ${label}` : `Previous in ${label}`}
                  onClick={() => move('previous')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d={rtl ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'} />
                  </svg>
                </button>
                <button type="button" className={styles.arrow} disabled={!position.next}
                  aria-controls={listId} aria-label={rtl ? `التالي في ${label}` : `Next in ${label}`}
                  onClick={() => move('next')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d={rtl ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} />
                  </svg>
                </button>
              </div>
            )}
            {footerAction && <div className={styles.footerAction}>{footerAction}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
