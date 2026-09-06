import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Poster } from '../components/Poster';
import { POSTER_DWELL_MS, POSTER_HOVER_MS, resetPosterRotationStagger } from '../components/PosterSet';

// UX_AUDIT_MOBILE_2026-09-05 P1 #13: two films without a licensed image read
// as the same empty frame. The slot carries the title's first letter when it
// is given one.
describe('Poster', () => {
  it('draws a placeholder mark when no licensed image exists', () => {
    const { container } = render(<Poster title={{ posterUrl: null }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    // Decorative: the title's name is beside it on every surface.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders the image the rights registry allowed, and no placeholder', () => {
    const { container } = render(<Poster title={{ posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/x.jpg');
    expect(container.querySelector('svg')).toBeNull();
    // P1-1: the image host is asked directly, so it must not also be told
    // which page of ours the viewer was reading.
    expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it("shows the title's first letter when there is no licensed image", () => {
    const { container } = render(<Poster title={{ posterUrl: null }} name="يد إلهية" />);

    expect(container.textContent).toBe('ي');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('keeps the neutral mark when it is given no name', () => {
    const { container } = render(<Poster title={{ posterUrl: null }} />);

    expect(container.textContent).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  // POSTERS-MULTI P5 (ADR-120), direction د -- the owner's directive of
  // 2026-09-06: on touch the posters rotate on their own, with nothing to tap;
  // with a fine pointer they cycle under the hover and return when it leaves;
  // under reduced motion nothing moves and nothing extra is even fetched.
  describe('poster set', () => {
    const a = 'https://image.tmdb.org/t/p/w342/a.jpg';
    const b = 'https://image.tmdb.org/t/p/w342/b.jpg';
    const c = 'https://image.tmdb.org/t/p/w342/c.jpg';
    const source = { name: 'TMDB', attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' };
    const posters = [a, b, c].map((posterUrl) => ({ posterUrl, posterSource: source }));

    function stubMedia({ reduced, hover }: { reduced: boolean; hover: boolean }) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        media: query,
        matches: query.includes('reduce') ? reduced : query.includes('hover') ? hover : false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
    }
    const active = (container: HTMLElement) => container.querySelector('[data-poster-layer][data-active]')?.getAttribute('src');

    beforeEach(() => {
      vi.useFakeTimers();
      resetPosterRotationStagger();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('rotates on its own on a touch screen, keeping only the shown image and the next in the tree', () => {
      stubMedia({ reduced: false, hover: false });
      const { container } = render(<Poster title={{ posterUrl: a, posters }} />);

      expect(active(container)).toBe(a);
      expect(container.querySelectorAll('[data-poster-layer]')).toHaveLength(2);
      // The first flip lands somewhere in the second dwell (neighbours are
      // staggered), never in the first.
      act(() => {
        vi.advanceTimersByTime(POSTER_DWELL_MS - 1);
      });
      expect(active(container)).toBe(a);
      act(() => {
        vi.advanceTimersByTime(POSTER_DWELL_MS);
      });
      expect(active(container)).toBe(b);
      act(() => {
        vi.advanceTimersByTime(POSTER_DWELL_MS);
      });
      expect(active(container)).toBe(c);
      act(() => {
        vi.advanceTimersByTime(POSTER_DWELL_MS);
      });
      expect(active(container)).toBe(a);
    });

    it('never flips while a finger is on the screen', () => {
      stubMedia({ reduced: false, hover: false });
      const { container } = render(<Poster title={{ posterUrl: a, posters }} />);

      act(() => {
        window.dispatchEvent(new Event('pointerdown'));
        vi.advanceTimersByTime(4 * POSTER_DWELL_MS);
      });
      expect(active(container)).toBe(a);
      act(() => {
        window.dispatchEvent(new Event('pointerup'));
        vi.advanceTimersByTime(POSTER_DWELL_MS);
      });
      expect(active(container)).toBe(b);
    });

    it('stops completely under reduced motion: one still image, no clock, nothing else fetched', () => {
      stubMedia({ reduced: true, hover: false });
      const { container } = render(<Poster title={{ posterUrl: a, posters }} />);

      expect(vi.getTimerCount()).toBe(0);
      act(() => {
        vi.advanceTimersByTime(20 * POSTER_DWELL_MS);
      });
      const images = container.querySelectorAll('img');
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute('src')).toBe(a);
      expect(active(container)).toBe(a);
    });

    it('cycles under the pointer on a hover-capable screen and returns to the first image when it leaves', () => {
      stubMedia({ reduced: false, hover: true });
      const { container } = render(<Poster title={{ posterUrl: a, posters }} />);

      // Nothing moves on its own with a fine pointer, and nothing extra loads.
      act(() => {
        vi.advanceTimersByTime(5 * POSTER_DWELL_MS);
      });
      expect(active(container)).toBe(a);
      expect(container.querySelectorAll('[data-poster-layer]')).toHaveLength(1);

      const stack = container.querySelector('[data-poster-stack]')!;
      act(() => {
        stack.dispatchEvent(new Event('pointerenter'));
      });
      expect(container.querySelectorAll('[data-poster-layer]')).toHaveLength(2);
      act(() => {
        vi.advanceTimersByTime(POSTER_HOVER_MS);
      });
      expect(active(container)).toBe(b);
      act(() => {
        stack.dispatchEvent(new Event('pointerleave'));
      });
      expect(active(container)).toBe(a);
    });

    it('follows a caller-driven index instead of its own clock', () => {
      stubMedia({ reduced: false, hover: false });
      const { container, rerender } = render(<Poster title={{ posterUrl: a, posters }} posterIndex={0} />);
      expect(vi.getTimerCount()).toBe(0);
      rerender(<Poster title={{ posterUrl: a, posters }} posterIndex={2} />);
      expect(active(container)).toBe(c);
    });

    it('is the plain single image for one poster, and an absent or empty field behaves exactly like today', () => {
      stubMedia({ reduced: false, hover: false });
      const single = render(<Poster title={{ posterUrl: a, posters: posters.slice(0, 1) }} />).container;
      expect(single.querySelectorAll('img')).toHaveLength(1);
      expect(single.querySelector('[data-poster-stack]')).toBeNull();
      const withoutField = render(<Poster title={{ posterUrl: a }} />).container.querySelector('img');
      const withEmptyArray = render(<Poster title={{ posterUrl: a, posters: [] }} />).container.querySelector('img');
      expect(withoutField?.outerHTML).toBe(withEmptyArray?.outerHTML);
    });

    it('the hollow placeholder is unaffected by posters (no poster still means no poster)', () => {
      stubMedia({ reduced: false, hover: false });
      const { container } = render(<Poster title={{ posterUrl: null, posters }} />);

      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });
});
