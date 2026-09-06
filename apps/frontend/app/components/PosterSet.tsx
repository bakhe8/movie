'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Which of a film's posters to show (POSTERS-MULTI P5, direction د -- the
 * owner's directive of 2026-09-06, relayed by the coordinator).
 *
 * On a touch screen the posters rotate on their own: no dots, no strip,
 * nothing new to tap, so no tap target competes with "watched" on a Discover
 * tile and no 44px problem exists on a 56px poster. The clock only runs while
 * the poster is mostly on screen, never flips under a finger or during a
 * scroll, and staggers neighbours so two cards never change together.
 *
 * With a fine pointer nothing moves on its own: hovering (or focusing) the
 * poster cycles it, leaving restores the first image, so a grid stays still
 * and a card keeps its identity.
 *
 * Under `prefers-reduced-motion: reduce` there is no rotation of any kind --
 * one still image, no clock, and (see Poster) no other image is even loaded.
 * `active` tells the caller whether more than the first image is wanted at
 * all, so the next image is fetched only when it is about to be shown.
 */
export const POSTER_DWELL_MS = 2800;
export const POSTER_HOVER_MS = 1200;
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const STAGGER_MS = 900;
const SCROLL_SETTLE_MS = 200;
const VISIBLE_RATIO = 0.6;

let mounted = 0;

// Tests only: start the stagger from the first phase again.
export function resetPosterRotationStagger() {
  mounted = 0;
}

function media(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

export interface PosterRotation {
  index: number;
  active: boolean;
}

export function usePosterRotation(
  count: number,
  ref: RefObject<HTMLElement | null>,
  dwellMs = POSTER_DWELL_MS,
  hoverMs = POSTER_HOVER_MS,
): PosterRotation {
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (count < 2) return;
    const reduced = media(REDUCED_MOTION_QUERY);
    const hover = media(HOVER_QUERY);
    const element = ref.current;
    let cleanup: (() => void) | null = null;

    const startHover = () => {
      if (!element) return null;
      let timer: ReturnType<typeof setInterval> | null = null;
      const enter = () => {
        if (timer) return;
        setActive(true);
        timer = setInterval(() => setIndex((i) => (i + 1) % count), hoverMs);
      };
      const leave = () => {
        if (timer) clearInterval(timer);
        timer = null;
        setActive(false);
        setIndex(0);
      };
      element.addEventListener('pointerenter', enter);
      element.addEventListener('pointerleave', leave);
      element.addEventListener('focusin', enter);
      element.addEventListener('focusout', leave);
      return () => {
        if (timer) clearInterval(timer);
        element.removeEventListener('pointerenter', enter);
        element.removeEventListener('pointerleave', leave);
        element.removeEventListener('focusin', enter);
        element.removeEventListener('focusout', leave);
      };
    };

    const startRotation = () => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let visible = true;
      let scrollingUntil = 0;
      let pressed = false;
      // Neighbours mounted together get different phases, so a grid never
      // flips several cards in the same instant.
      const phase = (mounted++ * STAGGER_MS) % dwellMs;
      const tick = () => {
        if (visible && !pressed && Date.now() >= scrollingUntil) {
          setIndex((i) => (i + 1) % count);
        }
        timer = setTimeout(tick, dwellMs);
      };
      const onScroll = () => {
        scrollingUntil = Date.now() + SCROLL_SETTLE_MS;
      };
      const onDown = () => {
        pressed = true;
      };
      const onUp = () => {
        pressed = false;
      };
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('pointerdown', onDown, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
      window.addEventListener('pointercancel', onUp, { passive: true });
      let observer: IntersectionObserver | null = null;
      if (element && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          ([entry]) => {
            visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
          },
          { threshold: [0, VISIBLE_RATIO] },
        );
        observer.observe(element);
      }
      setActive(true);
      timer = setTimeout(tick, dwellMs + phase);
      return () => {
        if (timer) clearTimeout(timer);
        window.removeEventListener('scroll', onScroll, { capture: true });
        window.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        observer?.disconnect();
      };
    };

    const start = () => {
      cleanup?.();
      cleanup = null;
      if (reduced?.matches) return; // one still image; no clock at all
      cleanup = hover?.matches ? startHover() : startRotation();
    };
    // A preference can change while the page is open: settle to the first
    // image and start over under the new rule.
    const onMedia = () => {
      setIndex(0);
      setActive(false);
      start();
    };
    start();
    reduced?.addEventListener?.('change', onMedia);
    hover?.addEventListener?.('change', onMedia);
    return () => {
      cleanup?.();
      reduced?.removeEventListener?.('change', onMedia);
      hover?.removeEventListener?.('change', onMedia);
    };
  }, [count, ref, dwellMs, hoverMs]);

  if (count < 2) {
    return { index: 0, active: false };
  }
  return { index: index % count, active };
}
