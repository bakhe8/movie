import { describe, expect, it } from 'vitest';
import { diversify, foldArabic } from './starter';

const title = (titleEn: string, releaseYear: number | null, genres: string[] | null) => ({ titleEn, releaseYear, genres });

describe('diversify (starter list, blueprint §4.2)', () => {
  it('picks round-robin across primary genres, largest genre first, newest first within a genre', () => {
    const catalogue = [
      title('Drama Old', 1990, ['Drama']),
      title('Drama New', 2020, ['Drama']),
      title('Drama Mid', 2005, ['Drama']),
      title('Comedy New', 2019, ['Comedy']),
      title('Comedy Old', 1999, ['Comedy']),
      title('Horror Only', 2017, ['Horror']),
    ];

    const picks = diversify(catalogue, 4).map((t) => t.titleEn);

    // Round 1 takes one from each genre (Drama has 3, Comedy 2, Horror 1),
    // round 2 starts again with Drama -- no genre dominates the top.
    expect(picks).toEqual(['Drama New', 'Comedy New', 'Horror Only', 'Drama Mid']);
  });

  it('is deterministic and returns at most the limit, or everything when the catalogue is smaller', () => {
    const catalogue = [title('A', 2000, ['X']), title('B', 2001, ['Y'])];

    expect(diversify(catalogue, 10)).toEqual(diversify(catalogue, 10));
    expect(diversify(catalogue, 10)).toHaveLength(2);
    expect(diversify(catalogue, 1)).toHaveLength(1);
    expect(diversify([], 5)).toEqual([]);
    expect(diversify(catalogue, 0)).toEqual([]);
  });

  it('groups titles with no genre under one bucket instead of dropping them', () => {
    const catalogue = [title('No genre', 2010, null), title('Empty genre', 2011, []), title('Drama', 2012, ['Drama'])];

    const picks = diversify(catalogue, 3).map((t) => t.titleEn);

    expect(picks).toHaveLength(3);
    expect(picks).toContain('No genre');
    expect(picks).toContain('Empty genre');
  });
});

describe('foldArabic (search folding)', () => {
  it('folds hamza forms of alef, taa marbuta and alef maqsura and strips tashkeel', () => {
    expect(foldArabic('أحلام')).toBe('احلام');
    expect(foldArabic('إبراهيم')).toBe('ابراهيم');
    expect(foldArabic('آخر')).toBe('اخر');
    expect(foldArabic('مدرسة')).toBe('مدرسه');
    expect(foldArabic('مصطفى')).toBe('مصطفي');
    expect(foldArabic('مُحَمَّد')).toBe('محمد');
    expect(foldArabic('الـوصـول')).toBe('الوصول');
  });

  it('leaves non-Arabic text untouched', () => {
    expect(foldArabic('Arrival 2016')).toBe('Arrival 2016');
  });
});
