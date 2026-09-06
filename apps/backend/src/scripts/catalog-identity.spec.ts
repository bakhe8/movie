import { describe, expect, it } from 'vitest';
import { assertCumulativeIdentities, assertReservedIdentities, assertSourceReservations, assertUniqueIdentities, CatalogIdentity, ID_PROVIDERS, mergeCatalog } from './catalog-identity';
import reserved from './fixtures/catalog.demo.identity.json';
import catalog from './fixtures/catalog.demo.json';

const original = { internalId: 'DEMO0001', externalIds: { wikidata: 'Q1', imdb: 'tt0000001', tmdb: '1' } };
const other = { internalId: 'DEMO0002', externalIds: { wikidata: 'Q2', imdb: 'tt0000002', tmdb: '2' } };

describe('cumulative catalog identity', () => {
  it('pins the admitted fixture and 425 reserved source rows', () => {
    expect(reserved).toHaveLength(425);
    assertReservedIdentities(reserved, catalog);
  });
  it('rejects duplicate internalIds even for identical rows', () => {
    expect(() => assertUniqueIdentities([original, original])).toThrow('collision internalId');
  });
  it('source rows may be reordered but never renumbered, rebound, dropped or appended without a reservation', () => {
    assertSourceReservations(reserved, [...reserved].reverse());
    expect(() => assertSourceReservations(reserved, reserved.slice(1))).toThrow('same members');
    const swapped = structuredClone(reserved);
    [swapped[0].internalId, swapped[1].internalId] = [swapped[1].internalId, swapped[0].internalId];
    expect(() => assertSourceReservations(reserved, swapped)).toThrow('rebind');
    expect(() => assertSourceReservations(reserved, [...reserved, { ...reserved[0], internalId: 'DEMO0426', externalIds: undefined }])).toThrow('same members');
  });
  it.each(ID_PROVIDERS)('rejects %s collisions within a batch and against other admitted works', (provider) => {
    const duplicate = { ...other, externalIds: { ...other.externalIds, [provider]: original.externalIds[provider] } };
    expect(() => assertUniqueIdentities([original, duplicate])).toThrow(`collision ${provider}`);
    expect(() => assertCumulativeIdentities([original], [duplicate])).toThrow(`collision ${provider}`);
  });
  it.each(ID_PROVIDERS)('rejects changing, clearing or swapping %s', (provider) => {
    const changed = { ...original, externalIds: { ...original.externalIds, [provider]: other.externalIds[provider] } };
    expect(() => assertCumulativeIdentities([original], [changed])).toThrow('rebind');
    const cleared: CatalogIdentity = structuredClone(original);
    delete cleared.externalIds![provider];
    expect(() => assertCumulativeIdentities([original], [cleared])).toThrow('rebind');
    expect(() => assertCumulativeIdentities([original, other], [changed, { ...other, externalIds: original.externalIds }])).toThrow();
  });
  it('allows an additive ID and metadata refresh, never removing an admitted work', () => {
    assertCumulativeIdentities([{ ...original, externalIds: { wikidata: 'Q1' } }], [original]);
    expect(() => assertCumulativeIdentities([original, other], [original], true)).toThrow('removed');
    expect(() => assertReservedIdentities([original], [other])).toThrow('unreserved');
    expect(() => assertReservedIdentities([{ ...original, externalIds: { wikidata: 'Q1' } }], [original])).toThrow('rebind');
  });
  it('allows separate remakes with separate provider IDs, independent of title spelling/year', () => {
    assertUniqueIdentities([{ ...original, titleEn: 'The Remake' }, { ...other, titleEn: 'The Remake' }] as CatalogIdentity[]);
    // A dub/cut of one work belongs to title_editions, never a duplicate titles row.
    expect(() => assertUniqueIdentities([original, { ...other, externalIds: original.externalIds }])).toThrow();
  });
  it.each([' Q1', 'q1', '', null, 1])('fails closed on malformed IDs (%s)', (value) => {
    expect(() => assertUniqueIdentities([{ ...original, externalIds: { wikidata: value } } as CatalogIdentity])).toThrow('invalid');
  });
  it('preserves admitted enrichment and unselected works on a partial rebuild', () => {
    const before = [{ ...original, fingerprint: { pacing: 0.5 }, posterPath: '/old.jpg' }, { ...other, fingerprint: null, posterPath: null }];
    const merged = mergeCatalog(before, [{ ...original, fingerprint: null, posterPath: null }]);
    expect(merged).toEqual(before);
  });
  it('refreshes all builder metadata and evidence on a full rebuild, retaining only downstream derivatives', () => {
    const old = {
      ...original, titleEn: 'Old title', titleAr: 'عنوان قديم', description: 'Old description',
      releaseYear: 2000, genres: ['Drama'], originalLanguage: 'en', obsoleteSourceField: 'remove me',
      fingerprint: { pacing: 0.5 }, posterPath: '/poster.jpg', cultural: { setting: 'city' },
      evidence: { plotSummary: 'Old plot', plotSource: 'old source', titleArSource: 'old Arabic source',
        sourceIds: ['old'], wikipedia: { en: 'Old_page' }, wikidataLabelEn: 'Old label',
        obsoleteEvidence: 'remove me too', plotSummaryAr: 'حبكة موثقة', plotSourceAr: 'Arabic plot source' },
    };
    const fresh = {
      ...original, titleEn: 'Current title', titleAr: 'عنوان حالي', description: 'Current description',
      releaseYear: 2001, genres: ['Comedy'], originalLanguage: 'ar',
      fingerprint: null, posterPath: null, cultural: null,
      evidence: { plotSummary: 'Current plot', plotSource: 'current source', titleArSource: 'current Arabic source',
        sourceIds: ['current'], wikipedia: { en: 'Current_page' }, wikidataLabelEn: 'Current label' },
    };
    const oldSnapshot = structuredClone(old);
    const freshSnapshot = structuredClone(fresh);
    expect(mergeCatalog<typeof old | typeof fresh>([old], [fresh])).toEqual([{
      ...fresh, fingerprint: old.fingerprint, posterPath: old.posterPath, cultural: old.cultural,
      evidence: { ...fresh.evidence, plotSummaryAr: old.evidence.plotSummaryAr, plotSourceAr: old.evidence.plotSourceAr },
    }]);
    expect(old).toEqual(oldSnapshot);
    expect(fresh).toEqual(freshSnapshot);
  });
  it('preserves explicit null derivatives and does not synthesize absent downstream fields', () => {
    const old = { ...original, fingerprint: null, posterPath: null, cultural: null,
      evidence: { plotSummaryAr: null, plotSourceAr: null } };
    const fresh = { ...original, fingerprint: { pacing: 1 }, posterPath: '/new.jpg', cultural: { setting: 'new' },
      evidence: { plotSummary: 'new plot' } };
    expect(mergeCatalog<typeof old | typeof fresh>([old], [fresh])).toEqual([{ ...old, evidence: { ...fresh.evidence, ...old.evidence } }]);
    expect(mergeCatalog([original], [fresh])).toEqual([fresh]);
  });
});
