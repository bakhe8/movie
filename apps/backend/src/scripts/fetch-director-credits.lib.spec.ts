import { describe, expect, it } from 'vitest';
import { buildDirectorCredits, extractDirectorQids, renderReport, summarize, type WikidataEntity } from './fetch-director-credits.lib';

function entity(overrides: Partial<WikidataEntity> = {}): WikidataEntity {
  return { id: 'Q0', ...overrides };
}

describe('extractDirectorQids', () => {
  it('reads P57 item-reference claims in statement order', () => {
    const result = extractDirectorQids(
      entity({
        claims: {
          P57: [
            { mainsnak: { datavalue: { value: { id: 'Q1' } } } },
            { mainsnak: { datavalue: { value: { id: 'Q2' } } } },
          ],
        },
      }),
    );

    expect(result).toEqual(['Q1', 'Q2']);
  });

  it('returns empty for a title with no P57 claim at all', () => {
    expect(extractDirectorQids(entity())).toEqual([]);
  });

  it('skips a malformed snak instead of fabricating a value', () => {
    const result = extractDirectorQids(
      entity({
        claims: {
          P57: [{ mainsnak: { datavalue: { value: 'not-a-reference' } } }, { mainsnak: {} }, {}],
        },
      }),
    );

    expect(result).toEqual([]);
  });
});

describe('buildDirectorCredits', () => {
  it('joins a title to its resolved directors with bilingual labels', () => {
    const titles = [{ internalId: 'DEMO0001', wikidataId: 'Q100' }];
    const titleEntities = {
      Q100: entity({ id: 'Q100', claims: { P57: [{ mainsnak: { datavalue: { value: { id: 'Q1' } } } }] } }),
    };
    const personEntities = {
      Q1: entity({ id: 'Q1', labels: { en: { value: 'Youssef Chahine' }, ar: { value: 'يوسف شاهين' } } }),
    };

    const result = buildDirectorCredits(titles, titleEntities, personEntities);

    expect(result).toEqual([
      {
        internalId: 'DEMO0001',
        titleWikidataId: 'Q100',
        directors: [{ wikidataId: 'Q1', nameEn: 'Youssef Chahine', nameAr: 'يوسف شاهين', creditOrder: 0 }],
      },
    ]);
  });

  it('records an empty directors array, not a missing entry, when there is no P57 claim', () => {
    const titles = [{ internalId: 'DEMO0002', wikidataId: 'Q200' }];
    const titleEntities = { Q200: entity({ id: 'Q200' }) };

    const result = buildDirectorCredits(titles, titleEntities, {});

    expect(result).toEqual([{ internalId: 'DEMO0002', titleWikidataId: 'Q200', directors: [] }]);
  });

  it('records an empty directors array when the title entity itself never resolved', () => {
    const titles = [{ internalId: 'DEMO0003', wikidataId: 'Q300' }];

    const result = buildDirectorCredits(titles, {}, {});

    expect(result).toEqual([{ internalId: 'DEMO0003', titleWikidataId: 'Q300', directors: [] }]);
  });

  it('leaves a label null rather than fabricating one when a director entity has no label in that language', () => {
    const titles = [{ internalId: 'DEMO0004', wikidataId: 'Q400' }];
    const titleEntities = {
      Q400: entity({ id: 'Q400', claims: { P57: [{ mainsnak: { datavalue: { value: { id: 'Q9' } } } }] } }),
    };
    const personEntities = { Q9: entity({ id: 'Q9', labels: { en: { value: 'Someone' } } }) };

    const result = buildDirectorCredits(titles, titleEntities, personEntities);

    expect(result[0].directors[0]).toEqual({ wikidataId: 'Q9', nameEn: 'Someone', nameAr: null, creditOrder: 0 });
  });

  it('preserves multiple directors in Wikidata statement order', () => {
    const titles = [{ internalId: 'DEMO0005', wikidataId: 'Q500' }];
    const titleEntities = {
      Q500: entity({
        id: 'Q500',
        claims: {
          P57: [
            { mainsnak: { datavalue: { value: { id: 'Q11' } } } },
            { mainsnak: { datavalue: { value: { id: 'Q12' } } } },
          ],
        },
      }),
    };
    const personEntities = {
      Q11: entity({ id: 'Q11', labels: { en: { value: 'First' } } }),
      Q12: entity({ id: 'Q12', labels: { en: { value: 'Second' } } }),
    };

    const result = buildDirectorCredits(titles, titleEntities, personEntities);

    expect(result[0].directors.map((director) => [director.wikidataId, director.creditOrder])).toEqual([
      ['Q11', 0],
      ['Q12', 1],
    ]);
  });
});

describe('summarize', () => {
  it('counts titles with/without a director claim and distinct directors across all of them', () => {
    const credits = [
      { internalId: 'DEMO0001', titleWikidataId: 'Q1', directors: [{ wikidataId: 'QA', nameEn: 'A', nameAr: null, creditOrder: 0 }] },
      { internalId: 'DEMO0002', titleWikidataId: 'Q2', directors: [{ wikidataId: 'QA', nameEn: 'A', nameAr: null, creditOrder: 0 }] },
      { internalId: 'DEMO0003', titleWikidataId: 'Q3', directors: [] },
    ];

    const stats = summarize(credits, []);

    expect(stats).toEqual({
      totalTitles: 3,
      titlesWithAtLeastOneDirector: 2,
      titlesWithNoDirectorClaim: 1,
      distinctDirectors: 1, // QA shared by two titles counts once
      failures: [],
    });
  });

  it('adds failures into the total without counting them as directorless successes', () => {
    const stats = summarize([], [{ internalId: 'DEMO0009', detail: 'HTTP 500' }]);

    expect(stats.totalTitles).toBe(1);
    expect(stats.titlesWithNoDirectorClaim).toBe(0);
    expect(stats.failures).toEqual([{ internalId: 'DEMO0009', detail: 'HTTP 500' }]);
  });
});

describe('renderReport', () => {
  it('includes a failures table only when there are failures', () => {
    const withFailures = renderReport(
      { totalTitles: 2, titlesWithAtLeastOneDirector: 1, titlesWithNoDirectorClaim: 0, distinctDirectors: 1, failures: [{ internalId: 'DEMO0009', detail: 'HTTP 500' }] },
      new Date('2026-09-03T00:00:00Z'),
    );
    const withoutFailures = renderReport(
      { totalTitles: 1, titlesWithAtLeastOneDirector: 1, titlesWithNoDirectorClaim: 0, distinctDirectors: 1, failures: [] },
      new Date('2026-09-03T00:00:00Z'),
    );

    expect(withFailures).toContain('## Failures');
    expect(withFailures).toContain('DEMO0009');
    expect(withoutFailures).not.toContain('## Failures');
  });
});
