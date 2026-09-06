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
});
