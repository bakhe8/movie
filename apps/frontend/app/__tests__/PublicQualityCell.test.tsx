import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PublicQualityCell } from '../public-quality/PublicQualityCell';
import type { PublicQuality } from '../public-quality/types';

const quality: PublicQuality = {
  value: 8.1,
  votes: 250000,
  sources: [{ source: 'imdb', value: 8.1, scale: '1-10', votes: 250000, capturedAt: '2026-08-14T09:00:00.000Z', attribution: null }],
};

describe('PublicQualityCell', () => {
  it('shows the day the score was captured, in Arabic', () => {
    render(<PublicQualityCell quality={quality} lang="ar" />);
    // Gregorian, Latin digits (format.ts): the day is what matters here.
    expect(screen.getByText(/بتاريخ/)).toHaveTextContent('2026');
  });

  it('shows it in English too', () => {
    render(<PublicQualityCell quality={quality} lang="en" />);
    expect(screen.getByText(/as of/)).toHaveTextContent('Aug 14, 2026');
  });

  it('stays hollow with no source, and shows no date', () => {
    render(<PublicQualityCell quality={{ value: null, votes: null, sources: [] }} lang="ar" />);
    expect(screen.getByText('لا مصدر بعد')).toBeInTheDocument();
    expect(screen.queryByText(/بتاريخ/)).toBeNull();
  });

  // The owner's addenda 3 and 4, and their explicit instruction: a source with
  // a mark of its own wears it instead of its name. The artwork is IMDb's own
  // file, unedited (public/brand/NOTICE).
  it("wears the source's own mark instead of writing its name", () => {
    const { container } = render(<PublicQualityCell quality={quality} lang="ar" />);
    const mark = container.querySelector('img[alt="IMDb"]');

    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('src', '/brand/imdb.svg');
    // The name is the mark's to say now; the votes and the date still read.
    expect(container.textContent).not.toContain('IMDb');
    expect(container.textContent).toContain('250,000');
  });

  it('keeps a neutral star for a source with no mark of its own', () => {
    const other = { value: 74, votes: 12, sources: [{ source: 'other', value: 74, scale: '0-100', votes: 12, capturedAt: '2026-09-01T00:00:00.000Z', attribution: null }] };
    const { container } = render(<PublicQualityCell quality={other} lang="ar" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('other');
  });
});
