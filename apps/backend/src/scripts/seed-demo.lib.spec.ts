import { describe, expect, it } from 'vitest';
import {
  CatalogEntry,
  DIMENSIONS,
  MODEL_DIMENSIONS,
  catalogEntryToTitle,
  combinations,
  featureRowsFor,
  fingerprintVector,
  isCompleteFingerprint,
  hashSeed,
  mulberry32,
  rankByUtility,
  sampleTriad,
  sampleWatched,
  sessionTimestamps,
  spreadWatchedDates,
  utility,
  validateCatalogEntry,
  validatePersona,
} from './seed-demo.lib';

const NOW = new Date('2026-09-03T12:00:00Z');

/** A catalog entry whose fingerprint is `vector` in MODEL_DIMENSIONS order: V1 at the top level, V2 under `v2.features`. */
function entry(index: number, vector: number[] | null): CatalogEntry {
  const fingerprint = vector
    ? {
        ...Object.fromEntries(DIMENSIONS.map((dimension, position) => [dimension, vector[position]])),
        v2: {
          features: Object.fromEntries(
            MODEL_DIMENSIONS.slice(DIMENSIONS.length).map((dimension, position) => [dimension, vector[DIMENSIONS.length + position]]),
          ),
        },
      }
    : null;
  return {
    internalId: `DEMO${String(index).padStart(4, '0')}`,
    titleEn: `Film ${index}`,
    titleAr: `فيلم ${index}`,
    description: 'x',
    releaseYear: 2000,
    genres: ['Drama'],
    externalIds: { wikidata: `Q${index}` },
    fingerprint,
  };
}

// A synthetic catalog: 40 films along one axis (pacing), the rest at the midpoint.
function catalog(size = 40): CatalogEntry[] {
  return Array.from({ length: size }, (_, index) =>
    entry(index + 1, MODEL_DIMENSIONS.map((dimension) => (dimension === 'pacing' ? index / (size - 1) : 0.5))),
  );
}

describe('deterministic randomness', () => {
  it('mulberry32 reproduces the same stream for the same seed', () => {
    const first = mulberry32(42);
    const second = mulberry32(42);
    expect(Array.from({ length: 5 }, first)).toEqual(Array.from({ length: 5 }, second));
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  it('hashSeed is stable and distinguishes personas', () => {
    expect(hashSeed('20260903:slow-burn')).toBe(hashSeed('20260903:slow-burn'));
    expect(hashSeed('20260903:slow-burn')).not.toBe(hashSeed('20260903:spectacle'));
  });
});

describe('utility', () => {
  it('imputes unknown dimensions at the midpoint, never zero', () => {
    const theta = MODEL_DIMENSIONS.map(() => 1);
    const vector = fingerprintVector({ pacing: 1 }); // 27 unknowns: 12 V1 and the whole V2 block
    expect(vector).toHaveLength(28);
    expect(vector.filter((value) => value === null)).toHaveLength(27);
    expect(utility(theta, vector)).toBeCloseTo(1 + 27 * 0.5);
  });

  it('reads V2 families from the nested block in the trainer\'s order', () => {
    const vector = fingerprintVector({ pacing: 0.2, v2: { features: { 'tone.irony': 0.9, 'ending.optimism': 0.1 } } });
    expect(vector[0]).toBe(0.2);
    expect(vector[MODEL_DIMENSIONS.indexOf('tone.irony')]).toBe(0.9);
    expect(vector[MODEL_DIMENSIONS.indexOf('ending.optimism')]).toBe(0.1);
    expect(vector[MODEL_DIMENSIONS.indexOf('tone.unease')]).toBeNull();
    // A title with every V1 key but no v2 block is incomplete for the 28-key model, as in the trainer.
    const v1Only = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 0.5]));
    expect(isCompleteFingerprint(v1Only)).toBe(false);
    expect(isCompleteFingerprint({ ...v1Only, v2: { features: Object.fromEntries(MODEL_DIMENSIONS.slice(13).map((d) => [d, 0.5])) } })).toBe(true);
  });

  it('rejects the wrong dimensionality', () => {
    expect(() => utility([1, 2], fingerprintVector(null))).toThrow();
  });
});

describe('sampleWatched', () => {
  const theta = MODEL_DIMENSIONS.map((dimension) => (dimension === 'pacing' ? 1 : 0));

  it('returns the requested count without duplicates and honours mustInclude', () => {
    const picked = sampleWatched(mulberry32(1), catalog(), theta, 20, { mustInclude: ['DEMO0001'] });
    expect(picked).toHaveLength(20);
    expect(new Set(picked.map((item) => item.internalId)).size).toBe(20);
    expect(picked.some((item) => item.internalId === 'DEMO0001')).toBe(true);
  });

  it('draws about 70 % from the upper half by utility', () => {
    const picked = sampleWatched(mulberry32(7), catalog(), theta, 20);
    const fast = picked.filter((item) => (item.fingerprint?.pacing as number) >= 0.5).length;
    expect(fast).toBeGreaterThanOrEqual(12);
    expect(fast).toBeLessThanOrEqual(16);
  });

  it('is deterministic for a seed', () => {
    const ids = (seed: number) => sampleWatched(mulberry32(seed), catalog(), theta, 10).map((item) => item.internalId);
    expect(ids(3)).toEqual(ids(3));
    expect(ids(3)).not.toEqual(ids(4));
  });
});

describe('sampleTriad', () => {
  const eligible = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('never repeats the immediately previous triad and returns three distinct ids', () => {
    const rng = mulberry32(5);
    for (let round = 0; round < 50; round += 1) {
      const triad = sampleTriad(rng, eligible, ['a', 'b', 'c']);
      expect(triad).not.toBeNull();
      expect(new Set(triad!).size).toBe(3);
      expect(triad!.every((id) => ['d', 'e', 'f'].includes(id))).toBe(true);
    }
  });

  it('returns null when fewer than three titles are left', () => {
    expect(sampleTriad(mulberry32(1), ['a', 'b', 'c', 'd'], ['a', 'b'])).toBeNull();
  });

  it('includes a required title when it is eligible', () => {
    const triad = sampleTriad(mulberry32(2), eligible, [], { mustInclude: 'f' });
    expect(triad).toContain('f');
    expect(new Set(triad!).size).toBe(3);
  });
});

describe('rankByUtility', () => {
  const utilities = new Map([
    ['low', 0],
    ['mid', 1],
    ['high', 2],
  ]);

  it('returns a permutation of the input', () => {
    const ranking = rankByUtility(mulberry32(9), ['low', 'mid', 'high'], utilities, 0.5);
    expect([...ranking].sort()).toEqual(['high', 'low', 'mid']);
  });

  it('follows the utility order as the temperature goes to zero and gets noisy as it grows', () => {
    const cold = rankByUtility(mulberry32(1), ['low', 'mid', 'high'], utilities, 0.001);
    expect(cold).toEqual(['high', 'mid', 'low']);
    let disagreements = 0;
    const rng = mulberry32(11);
    for (let round = 0; round < 200; round += 1) {
      if (rankByUtility(rng, ['low', 'mid', 'high'], utilities, 50)[0] !== 'high') {
        disagreements += 1;
      }
    }
    expect(disagreements).toBeGreaterThan(50);
  });
});

describe('combinations', () => {
  it('computes n choose k', () => {
    expect(combinations(5, 3)).toBe(10);
    expect(combinations(60, 3)).toBe(34220);
    expect(combinations(2, 3)).toBe(0);
  });
});

describe('time helpers', () => {
  it('spreads watch dates in the past, oldest first', () => {
    const dates = spreadWatchedDates(mulberry32(3), 30, NOW, 18);
    expect(dates).toHaveLength(30);
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index].getTime()).toBeGreaterThanOrEqual(dates[index - 1].getTime());
    }
    expect(dates[dates.length - 1].getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(dates[0].getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 18 * 30 * 24 * 3600 * 1000);
  });

  it('groups triads in sittings of five on distinct days, answered 40–90 s after being shown, ascending', () => {
    const stamps = sessionTimestamps(mulberry32(4), 25, NOW);
    expect(stamps).toHaveLength(25);
    expect(new Set(stamps.map((stamp) => stamp.sessionIndex)).size).toBe(5);
    const days = new Set(stamps.map((stamp) => stamp.shownAt.toISOString().slice(0, 10)));
    expect(days.size).toBe(5);
    for (let index = 0; index < stamps.length; index += 1) {
      const gap = (stamps[index].answeredAt.getTime() - stamps[index].shownAt.getTime()) / 1000;
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(90);
      if (index > 0) {
        expect(stamps[index].shownAt.getTime()).toBeGreaterThan(stamps[index - 1].answeredAt.getTime());
      }
      expect(stamps[index].answeredAt.getTime()).toBeLessThan(NOW.getTime());
    }
  });
});

describe('featureRowsFor (content_features provenance)', () => {
  const v1 = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 0.5]));
  const full = {
    ...v1,
    confidence: { pacing: 0.8 },
    extractorVersion: 'enrichment-worker-v2',
    sourceIds: ['wikidata:Q1', 'wikipedia:en:X'],
    licenseStatus: 'unknown',
    reviewStatus: 'unreviewed',
    generatedAt: '2026-09-03T18:00:00Z',
    v2: {
      features: { 'tone.irony': 0.9, 'ending.optimism': 0.2 },
      confidence: { 'tone.irony': 0.6 },
      extractorVersion: 'enrichment-worker-v2-families-v1',
      sourceIds: ['wikidata:Q1'],
      licenseStatus: 'unknown',
      reviewStatus: 'unreviewed',
      generatedAt: '2026-09-04T09:00:00Z',
    },
  };

  it('writes one row per known V1 and V2 feature with the block it came from', () => {
    const rows = featureRowsFor({ ...entry(1, null), fingerprint: full }, 'title-uuid', NOW);
    expect(rows).toHaveLength(13 + 2);
    const pacing = rows.find((row: { featureKey: string }) => row.featureKey === 'pacing');
    expect(pacing).toMatchObject({
      titleId: 'title-uuid',
      value: 0.5,
      uncertainty: 0.2,
      extractorVersion: 'enrichment-worker-v2',
      sourceIds: ['wikidata:Q1', 'wikipedia:en:X'],
      licenseStatus: 'unknown',
      reviewStatus: 'unreviewed',
    });
    expect(pacing.validFrom.toISOString()).toBe('2026-09-03T18:00:00.000Z');
    const irony = rows.find((row: { featureKey: string }) => row.featureKey === 'tone.irony');
    expect(irony).toMatchObject({ value: 0.9, uncertainty: 0.4, extractorVersion: 'enrichment-worker-v2-families-v1', sourceIds: ['wikidata:Q1'] });
    expect(irony.validFrom.toISOString()).toBe('2026-09-04T09:00:00.000Z');
    // No confidence reported for this feature: uncertainty unknown, not 0.
    expect(rows.find((row: { featureKey: string }) => row.featureKey === 'ending.optimism').uncertainty).toBeNull();
  });

  it('skips missing dimensions, snapshots without an extractor version, and null fingerprints', () => {
    const partial = { ...full };
    delete (partial as Record<string, unknown>).colorSaturation;
    expect(featureRowsFor({ ...entry(1, null), fingerprint: partial }, 't', NOW).map((row: { featureKey: string }) => row.featureKey)).not.toContain('colorSaturation');
    expect(featureRowsFor({ ...entry(1, null), fingerprint: { ...v1 } }, 't', NOW)).toEqual([]);
    expect(featureRowsFor(entry(1, null), 't', NOW)).toEqual([]);
  });
});

describe('fixture mapping and validation', () => {
  it('keeps entity fields only and prefers the Arabic lead over a Wikidata stub', () => {
    const stub = { ...entry(1, null), description: '1955 film', descriptionSource: 'wikidata' as const, descriptionAr: 'فيلم مصري من 1955.' };
    expect(catalogEntryToTitle(stub).description).toBe('فيلم مصري من 1955.');
    const lead = { ...entry(2, null), descriptionSource: 'wikipedia:en' as const, descriptionAr: 'x' };
    expect(catalogEntryToTitle(lead).description).toBe('x'.length ? lead.description : null);
    expect(Object.keys(catalogEntryToTitle(lead)).sort()).toEqual(
      ['description', 'externalIds', 'fingerprint', 'genres', 'internalId', 'originalLanguage', 'releaseYear', 'titleAr', 'titleEn'].sort(),
    );
    expect(catalogEntryToTitle({ ...entry(3, null), originalLanguage: 'ar' }).originalLanguage).toBe('ar');
    expect(catalogEntryToTitle(entry(4, null)).originalLanguage).toBeNull();
  });

  it('flags malformed catalog entries and personas', () => {
    expect(validateCatalogEntry({ ...entry(1, null), internalId: 'FILM001' })).toContain('internalId must look like DEMO0001');
    expect(validateCatalogEntry({ ...entry(1, null), titleAr: '' })).toContain('titleAr missing');
    expect(validateCatalogEntry(entry(1, null))).toEqual([]);
    const persona = {
      slug: 'ok',
      nameAr: 'x',
      nameEn: 'x',
      taste: '',
      theta: MODEL_DIMENSIONS.map(() => 0),
      watched: 4,
      triads: 1,
      watchlist: 0,
      notWatched: 0,
      notes: 0,
      importedRatings: 0,
      replacements: { notRemembered: 2, notWatched: 0 },
      includePartialTitle: false,
      activeTriad: false,
      expectedBand: 'inconclusive' as const,
    };
    expect(validatePersona(persona)).toHaveLength(1); // 4 - 2 reserved < 3 eligible
    expect(validatePersona({ ...persona, watched: 6 })).toEqual([]);
    expect(validatePersona({ ...persona, theta: [1] })[0]).toMatch(/theta/);
  });
});
