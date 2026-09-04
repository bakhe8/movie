import { describe, expect, it } from 'vitest';

import {
  agreementByFeature,
  agreementByLanguage,
  DEFAULT_TOLERANCE,
  formatAgreementReport,
  languageGap,
  overallAgreement,
  type ReviewedPair,
} from './measure-review-agreement.lib';

const pairs: ReviewedPair[] = [
  { featureKey: 'pacing', humanValue: 0.5, originalValue: 0.45, originalLanguage: 'en' }, // agrees
  { featureKey: 'pacing', humanValue: 0.8, originalValue: 0.2, originalLanguage: 'ar' }, // disagrees
  { featureKey: 'linearity', humanValue: 0.9, originalValue: 0.1, originalLanguage: 'en' }, // disagrees
  { featureKey: 'linearity', humanValue: 0.5, originalValue: 0.55, originalLanguage: 'ar' }, // agrees
];

describe('overallAgreement', () => {
  it('is null-shaped, not zero, with no reviewed rows yet', () => {
    expect(overallAgreement([])).toEqual({ n: 0, agreeing: 0, rate: null, meanAbsDelta: null });
  });

  it('counts a row as agreeing within tolerance, disagreeing past it', () => {
    const result = overallAgreement(pairs, 0.15);
    expect(result).toEqual({ n: 4, agreeing: 2, rate: 0.5, meanAbsDelta: expect.closeTo(0.375, 5) });
  });
});

describe('agreementByFeature / agreementByLanguage', () => {
  it('groups by key, sorted least-agreeing first', () => {
    const mixed: ReviewedPair[] = [
      ...pairs, // pacing and linearity both land at 50% agreement
      { featureKey: 'warmth', humanValue: 0.9, originalValue: 0.1, originalLanguage: 'en' }, // 0% agreement: least
    ];
    const byFeature = agreementByFeature(mixed, 0.15);
    expect(byFeature[0].key).toBe('warmth');
    expect(byFeature.find((row) => row.key === 'pacing')).toMatchObject({ n: 2, agreeing: 1, rate: 0.5 });
  });

  it('falls back to "unknown" for a pair with no recorded language', () => {
    const byLanguage = agreementByLanguage([...pairs, { featureKey: 'warmth', humanValue: 0.5, originalValue: 0.5 }], 0.15);
    expect(byLanguage.find((row) => row.key === 'unknown')).toMatchObject({ n: 1, rate: 1 });
  });
});

describe('languageGap', () => {
  it('is null below the minimum sample per language, else the largest rate gap', () => {
    const thin = agreementByLanguage(pairs, 0.15); // 2 per language, below the default minSample of 5
    expect(languageGap(thin)).toBeNull();
    const wide = [
      ...Array.from({ length: 5 }, () => ({ featureKey: 'pacing', humanValue: 0.5, originalValue: 0.5, originalLanguage: 'en' })),
      ...Array.from({ length: 5 }, () => ({ featureKey: 'pacing', humanValue: 0.9, originalValue: 0.1, originalLanguage: 'ar' })),
    ];
    expect(languageGap(agreementByLanguage(wide, 0.15))).toBe(1); // 100% vs 0%
  });
});

describe('formatAgreementReport', () => {
  it('says plainly that there is nothing to gate on yet, rather than a fabricated 0%', () => {
    const report = formatAgreementReport(overallAgreement([]), [], [], DEFAULT_TOLERANCE, 0.2);
    expect(report).toContain('No reviewed rows exist yet');
    expect(report).not.toContain('0%');
  });

  it('reports the overall rate, the language gap against its bound, and both tables', () => {
    const byFeature = agreementByFeature(pairs, 0.15);
    const byLanguage = agreementByLanguage(pairs, 0.15);
    const report = formatAgreementReport(overallAgreement(pairs, 0.15), byFeature, byLanguage, 0.15, 0.2);
    expect(report).toContain('Overall agreement: 2/4 = 50%');
    expect(report).toContain('not yet measurable'); // thin per-language sample here too
    expect(report).toContain('`linearity`') ;
    expect(report).toContain('By original language');
  });
});
