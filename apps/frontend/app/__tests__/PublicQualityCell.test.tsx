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
});
