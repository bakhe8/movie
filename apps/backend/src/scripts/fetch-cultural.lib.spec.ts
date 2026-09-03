import { describe, expect, it } from 'vitest';

import {
  CULTURAL_EXTRACTOR_VERSION,
  buildCulturalReport,
  claimYear,
  countryCodeOf,
  coverageBy,
  culturalBlockFor,
  languageCodeOf,
  needsCultural,
  placeCountryIds,
  referencedIds,
  settingEraOf,
  settingPlaceOf,
  type CulturalEntry,
  type WdEntity,
} from './fetch-cultural.lib';

const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });
const str = (value: string) => ({ mainsnak: { datavalue: { value } } });
const time = (value: string) => ({ mainsnak: { datavalue: { value: { time: value } } } });
const entity = (id: string, label: string | null, claims: Record<string, unknown[]> = {}): WdEntity =>
  ({ id, ...(label ? { labels: { en: { value: label } } } : {}), claims } as WdEntity);

const referenced: Record<string, WdEntity> = {
  Q29919: entity('Q29919', 'Egyptian Arabic', { P220: [str('arz')] }),
  Q1860: entity('Q1860', 'English', { P218: [str('en')] }),
  Q150: entity('Q150', 'French', { P218: [str('fr')] }),
  Q79: entity('Q79', 'Egypt', { P297: [str('EG')] }),
  Q142: entity('Q142', 'France', { P297: [str('FR')] }),
  Q85: entity('Q85', 'Cairo', { P17: [item('Q79')] }),
  Q90: entity('Q90', 'Paris', { P17: [item('Q142')] }),
  Q7903: entity('Q7903', 'Nowhere-in-particular', {}),
  Q35724: entity('Q35724', '1950s', {}),
  Q362: entity('Q362', 'World War II', { P580: [time('+1939-09-01T00:00:00Z')], P582: [time('+1945-09-02T00:00:00Z')] }),
  Q11: entity('Q11', '19th century', {}),
  Q999: entity('Q999', 'a named era', {}),
  Q1942: entity('Q1942', '1942', {}),
};
const film = entity('Q765535', 'Cairo Station', {
  P364: [item('Q29919')],
  P495: [item('Q79'), item('Q142')],
  P840: [item('Q85'), item('Q7903'), item('Q79')],
  P2408: [item('Q35724'), item('Q362')],
});
const NOW = new Date('2026-09-04T20:00:00Z');

describe('codes and labels', () => {
  it('maps languages the way fetch-catalog does: Arabic varieties to ar, else 639-1, 639-3, label', () => {
    expect(languageCodeOf('Q29919', referenced)).toBe('ar');
    expect(languageCodeOf('Q1860', referenced)).toBe('en');
    expect(languageCodeOf('Q150', referenced)).toBe('fr');
    expect(languageCodeOf('Q404', referenced)).toBe('Q404'); // unresolved: the id, never a guess
  });

  it('maps countries to ISO 3166-1 alpha-2 and places to their country via P17, or to themselves when they are a country', () => {
    expect(countryCodeOf('Q79', referenced)).toBe('EG');
    expect(settingPlaceOf('Q85', referenced)).toEqual({ id: 'Q85', label: 'Cairo', countries: ['EG'] });
    expect(settingPlaceOf('Q79', referenced)).toEqual({ id: 'Q79', label: 'Egypt', countries: ['EG'] });
    expect(settingPlaceOf('Q7903', referenced)).toEqual({ id: 'Q7903', label: 'Nowhere-in-particular', countries: [] });
  });

  it("takes the place's current country: ended and deprecated P17 statements are skipped, preferred ones win", () => {
    const ended = { ...item('Q810'), qualifiers: { P582: [time('+1967-06-07T00:00:00Z')] } };
    const deprecated = { ...item('Q142'), rank: 'deprecated' as const };
    const withHistory = {
      ...referenced,
      Q810: entity('Q810', 'Jordan', { P297: [str('JO')] }),
      Q219060: entity('Q219060', 'State of Palestine', { P297: [str('PS')] }),
      Q39847: entity('Q39847', 'Nablus', { P17: [ended, deprecated, item('Q219060')] }),
      Q39848: entity('Q39848', 'Preferred-first', { P17: [item('Q79'), { ...item('Q142'), rank: 'preferred' as const }] }),
      Q23792: entity('Q23792', 'Palestine (region)', { P17: [item('Q219060'), item('Q801')] }),
      Q801: entity('Q801', 'Israel', { P297: [str('IL')] }),
    };
    expect(settingPlaceOf('Q39847', withHistory)).toEqual({ id: 'Q39847', label: 'Nablus', countries: ['PS'] });
    expect(settingPlaceOf('Q39848', withHistory)).toEqual({ id: 'Q39848', label: 'Preferred-first', countries: ['FR', 'EG'] });
    // A contested region with two current claimants lists both; nothing here picks a side.
    expect(settingPlaceOf('Q23792', withHistory)).toEqual({ id: 'Q23792', label: 'Palestine (region)', countries: ['PS', 'IL'] });
  });

  it('dates eras from their own claims first, then from a decade/century/year label, else leaves them undated', () => {
    expect(settingEraOf('Q362', referenced)).toEqual({ id: 'Q362', label: 'World War II', start: 1939, end: 1945 });
    expect(settingEraOf('Q35724', referenced)).toEqual({ id: 'Q35724', label: '1950s', start: 1950, end: 1959 });
    expect(settingEraOf('Q11', referenced)).toEqual({ id: 'Q11', label: '19th century', start: 1801, end: 1900 });
    expect(settingEraOf('Q1942', referenced)).toEqual({ id: 'Q1942', label: '1942', start: 1942, end: 1942 });
    expect(settingEraOf('Q999', referenced)).toEqual({ id: 'Q999', label: 'a named era', start: null, end: null });
    expect(claimYear(entity('Q1', null, { P585: [time('-0044-03-15T00:00:00Z')] }), 'P585')).toBe(-44);
  });
});

describe('the block', () => {
  it('reads the four claim families into codes, places with countries and dated eras, with CC0 provenance', () => {
    const block = culturalBlockFor('Q765535', film, referenced, NOW);
    expect(block.originalLanguages).toEqual(['ar']);
    expect(block.productionCountries).toEqual(['EG', 'FR']);
    expect(block.settingPlaces.map((place) => place.label)).toEqual(['Cairo', 'Nowhere-in-particular', 'Egypt']);
    expect(block.settingCountries).toEqual(['EG']); // distinct; a place without a country adds nothing
    expect(block.settingEras).toEqual([
      { id: 'Q35724', label: '1950s', start: 1950, end: 1959 },
      { id: 'Q362', label: 'World War II', start: 1939, end: 1945 },
    ]);
    expect(block.dialects).toBeNull();
    expect(block).toMatchObject({
      schemaVersion: 'film-cultural-v1',
      generatedBy: 'wikidata',
      generatedAt: '2026-09-04T20:00:00.000Z',
      extractorVersion: CULTURAL_EXTRACTOR_VERSION,
      sourceIds: ['wikidata:Q765535'],
      licenseStatus: 'commercial_allowed',
      reviewStatus: 'unreviewed',
    });
  });

  it('is empty, not invented, for an entity with no claims', () => {
    const block = culturalBlockFor('Q1', entity('Q1', null), referenced, NOW);
    expect(block.originalLanguages).toEqual([]);
    expect(block.settingPlaces).toEqual([]);
    expect(block.settingEras).toEqual([]);
    expect(block.sourceIds).toEqual(['wikidata:Q1']);
  });

  it('lists what to fetch: referenced ids, then the countries of the places', () => {
    expect(referencedIds(film)).toEqual(['Q29919', 'Q79', 'Q142', 'Q85', 'Q7903', 'Q35724', 'Q362']);
    expect(placeCountryIds(['Q85', 'Q90', 'Q7903'], referenced)).toEqual(['Q79', 'Q142']);
  });

  it('needsCultural is versioned and forceable', () => {
    const entry = { internalId: 'DEMO0001', titleEn: 'x', externalIds: { wikidata: 'Q1' } } as CulturalEntry;
    expect(needsCultural(entry)).toBe(true);
    const current = { ...entry, cultural: culturalBlockFor('Q1', film, referenced, NOW) };
    expect(needsCultural(current)).toBe(false);
    expect(needsCultural(current, true)).toBe(true);
    expect(needsCultural({ ...current, cultural: { ...current.cultural, extractorVersion: 'older' as never } })).toBe(true);
  });
});

describe('coverage report', () => {
  const v1 = Object.fromEntries(
    ['pacing', 'rhythmVariance', 'ambiguity', 'psychologicalDepth', 'warmth', 'darkness', 'linearity', 'dialogueDensity', 'actionIntensity', 'plotComplexity', 'visualComplexity', 'soundscapeComplexity', 'colorSaturation'].map((key) => [key, 0.5]),
  );
  const entries: CulturalEntry[] = [
    {
      internalId: 'DEMO0001',
      titleEn: 'Cairo Station',
      externalIds: { wikidata: 'Q765535' },
      slice: 'ar',
      tier: 'popular',
      fingerprint: { ...v1, confidence: { pacing: 0.8, warmth: 0.6 }, v2: { features: {} }, v3: { features: {} } },
      cultural: culturalBlockFor('Q765535', film, referenced, NOW),
    },
    {
      internalId: 'DEMO0002',
      titleEn: 'Partial',
      externalIds: { wikidata: 'Q2' },
      originalLanguage: 'en',
      slice: 'en',
      tier: 'niche',
      fingerprint: { pacing: 0.5, confidence: { pacing: 0.4 } },
      cultural: culturalBlockFor('Q2', entity('Q2', null, { P364: [item('Q1860')], P495: [item('Q142')], P840: [item('Q90')] }), referenced, NOW),
    },
    { internalId: 'DEMO0003', titleEn: 'No block', externalIds: { wikidata: 'Q3' }, fingerprint: null },
  ];

  it('counts per group: places, eras, fingerprint completeness and confidence, unknown as its own bucket', () => {
    const rows = coverageBy(entries, (entry) => entry.cultural?.originalLanguages[0] ?? entry.originalLanguage ?? 'unknown');
    expect(rows.map((row) => row.key)).toEqual(['ar', 'en', 'unknown']);
    expect(rows[0]).toMatchObject({ titles: 1, withPlace: 1, withEra: 1, v1Complete: 1, withV2: 1, withV3: 1, meanV1Confidence: 0.7 });
    expect(rows[1]).toMatchObject({ titles: 1, withPlace: 1, withEra: 0, v1Complete: 0, withV2: 0, withV3: 0, meanV1Confidence: 0.4 });
    expect(rows[2]).toMatchObject({ titles: 1, withPlace: 0, withEra: 0, v1Complete: 0, meanV1Confidence: null });
  });

  it('renders the tables and the review lists, and flags stories set outside their production country', () => {
    const report = buildCulturalReport(entries, '2026-09-04', 2);
    expect(report).toContain('| ar | 1 | 100 % | 100 % | 100 % | 100 % | 100 % | 0.70 |');
    expect(report).toContain('| unknown | 1 | 0 % | 0 % | 0 % | 0 % | 0 % | — |');
    // DEMO0001 is set in Egypt and produced in EG/FR, DEMO0002 in Paris for a French production: nothing set elsewhere.
    expect(report).toContain('Stories set outside their production country (0): None.');
    expect(report).toContain('No setting era (1): DEMO0002 Partial');
  });
});
