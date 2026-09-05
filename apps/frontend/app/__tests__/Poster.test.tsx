import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Poster } from '../components/Poster';

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
});
