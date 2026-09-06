import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Poster } from '../components/Poster';

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

  // POSTERS-MULTI P4 (ADR-120): plumbing only -- the field reaches the
  // component without changing what is rendered. P5 (pending an approved
  // visual direction) is what actually shows more than one image.
  describe('posters (plumbing, not yet rendered)', () => {
    const posters = [
      { posterUrl: 'https://image.tmdb.org/t/p/w342/a.jpg', posterSource: { name: 'tmdb', attribution: 'TMDB' } },
      { posterUrl: 'https://image.tmdb.org/t/p/w342/b.jpg', posterSource: { name: 'tmdb', attribution: 'TMDB' } },
    ];

    it('still renders exactly one image, at posterUrl, when posters carries more', () => {
      const { container } = render(<Poster title={{ posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg', posters }} />);

      const images = container.querySelectorAll('img');
      expect(images).toHaveLength(1);
      expect(images[0].getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/x.jpg');
    });

    it('accepts posters without needing it -- an absent or empty array behaves exactly like today', () => {
      const withoutField = render(<Poster title={{ posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg' }} />).container.querySelector('img');
      const withEmptyArray = render(<Poster title={{ posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg', posters: [] }} />).container.querySelector('img');

      expect(withoutField?.outerHTML.replace(/data-poster-count="0"\s*/, '')).toBe(withEmptyArray?.outerHTML.replace(/data-poster-count="0"\s*/, ''));
    });

    it('the hollow placeholder is unaffected by posters (no poster still means no poster)', () => {
      const { container } = render(<Poster title={{ posterUrl: null, posters }} />);

      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('svg')).not.toBeNull();
    });
  });
});
