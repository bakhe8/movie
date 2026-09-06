import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FILM_CLASSES,
  GENRE_MAP,
  buildDiscoverySparql,
  earliestYear,
  factsFromEntity,
  mapGenres,
  parseDiscoveryBindings,
  parseWikipediaLead,
  referencedLookup,
  stripArabicDisambiguation,
  type WdEntity,
} from './wikidata.lib';

// The fixture builder cannot be imported (it runs main() at load) and this
// scope may not edit it, so the mirror is checked textually: the genre map
// and film-class set here must equal fetch-catalog.ts's, key for key.
const FETCH_CATALOG = readFileSync(path.resolve(__dirname, '..', '..', '..', 'scripts', 'fetch-catalog.ts'), 'utf8');

function block(source: string, start: RegExp): string {
  const from = source.search(start);
  if (from < 0) throw new Error(`block not found: ${start}`);
  const end = source.indexOf('\n};', from) >= 0 ? source.indexOf('\n};', from) : source.indexOf(']);', from);
  return source.slice(from, end);
}

function parseGenreMap(source: string): Record<string, string[]> {
  const text = block(source, /const GENRE_MAP: Record<string, string\[\]> = \{/);
  const map: Record<string, string[]> = {};
  for (const line of text.split('\n')) {
    const match = /^\s*(?:'([^']+)'|"([^"]+)"|([a-z0-9-]+)):\s*\[([^\]]*)\],?\s*(?:\/\/.*)?$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? match[2] ?? match[3];
    const values = match[4]
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    map[key] = values;
  }
  return map;
}

function parseFilmClasses(source: string): string[] {
  const from = source.indexOf('const FILM_CLASSES = new Set([');
  const end = source.indexOf(']);', from);
  return [...source.slice(from, end).matchAll(/'(Q\d+)'/g)].map((match) => match[1]);
}

describe('vocabulary parity with fetch-catalog.ts', () => {
  it('mirrors GENRE_MAP exactly', () => {
    const theirs = parseGenreMap(FETCH_CATALOG);
    expect(Object.keys(theirs).length).toBeGreaterThan(100);
    expect(GENRE_MAP).toEqual(theirs);
  });

  it('mirrors FILM_CLASSES exactly', () => {
    expect([...FILM_CLASSES].sort()).toEqual(parseFilmClasses(FETCH_CATALOG).sort());
  });
});

describe('mapGenres', () => {
  it('folds known labels, keyword-matches the long tail, drops production tags, caps at four', () => {
    const result = mapGenres(['drama film', 'girls with guns', 'art film', 'crime film', 'war film', 'western', 'musical']);
    expect(result.genres).toEqual(['Drama', 'Action', 'Crime', 'War']);
    expect(result.unknown).toEqual(['girls with guns']);
    expect(result.dropped).toEqual([]);
    expect(mapGenres(['art film', 'cult film']).genres).toEqual([]);
    expect(mapGenres(['a production tag']).dropped).toEqual(['a production tag']);
  });
});

const referenced: Record<string, WdEntity> = {
  Q130232: { id: 'Q130232', labels: { en: { value: 'drama film' } } },
  Q29561: { id: 'Q29561', labels: { en: { value: 'Egyptian Arabic' } }, claims: { P220: [{ mainsnak: { datavalue: { value: 'arz' } } }] } },
  Q79: { id: 'Q79', labels: { en: { value: 'Egypt' } }, claims: { P297: [{ mainsnak: { datavalue: { value: 'EG' } } }] } },
};

const cairoStation: WdEntity = {
  id: 'Q765535',
  labels: { en: { value: 'Cairo Station' }, ar: { value: 'باب الحديد' } },
  descriptions: { en: { value: '1958 film by Youssef Chahine' } },
  claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }],
    P577: [{ mainsnak: { datavalue: { value: { time: '+1958-01-01T00:00:00Z' } } } }, { mainsnak: { datavalue: { value: { time: '+1959-00-00T00:00:00Z' } } } }],
    P136: [{ mainsnak: { datavalue: { value: { id: 'Q130232' } } } }],
    P364: [{ mainsnak: { datavalue: { value: { id: 'Q29561' } } } }],
    P495: [{ mainsnak: { datavalue: { value: { id: 'Q79' } } } }],
    P345: [{ mainsnak: { datavalue: { value: 'tt0051390' } } }],
    P4947: [{ mainsnak: { datavalue: { value: '47324' } } }],
  },
  sitelinks: { enwiki: { title: 'Cairo Station' }, arwiki: { title: 'باب الحديد (فيلم)' } },
};

const at = new Date('2026-09-06T10:00:00Z');

describe('factsFromEntity', () => {
  it('reads every fact with Wikidata provenance and the description with Wikipedia provenance', () => {
    const lead = 'Cairo Station is a 1958 Egyptian drama film directed by Youssef Chahine. It follows a newspaper seller. A third sentence.';
    const facts = factsFromEntity(cairoStation, referencedLookup(referenced), { en: lead, ar: 'باب الحديد فيلم مصري. صدر سنة 1958. جملة ثالثة.' }, at);
    expect(facts.wikidataId).toBe('Q765535');
    expect(facts.imdbId).toBe('tt0051390');
    expect(facts.tmdbId).toBe('47324');
    expect(facts.titleEn?.value).toBe('Cairo Station');
    expect(facts.titleAr).toEqual({ value: 'باب الحديد', provenance: expect.objectContaining({ source: 'wikidata', licenseStatus: 'commercial_allowed', url: 'https://www.wikidata.org/wiki/Q765535' }) });
    expect(facts.description?.value).toBe('Cairo Station is a 1958 Egyptian drama film directed by Youssef Chahine. It follows a newspaper seller.');
    expect(facts.description?.provenance).toMatchObject({ source: 'wikipedia:en', url: 'https://en.wikipedia.org/wiki/Cairo_Station' });
    expect(facts.descriptionIsStub).toBe(false);
    expect(facts.descriptionAr?.value).toBe('باب الحديد فيلم مصري. صدر سنة 1958.');
    expect(facts.releaseYear?.value).toBe(1958);
    expect(facts.genres?.value).toEqual(['Drama']);
    expect(facts.originalLanguage?.value).toBe('ar');
    expect(facts.countries?.value).toEqual(['EG']);
    expect(facts.isFilm).toBe(true);
    expect(facts.warnings).toEqual([]);
  });

  it('falls back to the Wikidata stub and says so, and never invents an Arabic title', () => {
    const noAr: WdEntity = { ...cairoStation, labels: { en: { value: 'Cairo Station' } }, sitelinks: { enwiki: { title: 'Cairo Station' } } };
    const facts = factsFromEntity(noAr, referencedLookup(referenced), {}, at);
    expect(facts.titleAr).toBeNull();
    expect(facts.description?.value).toBe('1958 film by Youssef Chahine');
    expect(facts.descriptionIsStub).toBe(true);
    expect(facts.warnings).toEqual(expect.arrayContaining([expect.stringContaining('no-arabic-title'), expect.stringContaining('description-from-wikidata')]));
  });

  it('takes the Arabic title from the arwiki page when there is no label, stripping the disambiguator, with Wikipedia provenance', () => {
    const fromPage: WdEntity = { ...cairoStation, labels: { en: { value: 'Cairo Station' } } };
    const facts = factsFromEntity(fromPage, referencedLookup(referenced), {}, at);
    expect(facts.titleAr?.value).toBe('باب الحديد');
    expect(facts.titleAr?.provenance.source).toBe('wikipedia:ar');
  });

  it('flags a non-film class and leaves the class question open when P31 is absent', () => {
    const book: WdEntity = { ...cairoStation, claims: { ...cairoStation.claims, P31: [{ mainsnak: { datavalue: { value: { id: 'Q7725634' } } } }] } };
    expect(factsFromEntity(book, referencedLookup(referenced), {}, at).isFilm).toBe(false);
    const withoutClass = { ...cairoStation.claims };
    delete withoutClass.P31;
    expect(factsFromEntity({ ...cairoStation, claims: withoutClass }, referencedLookup(referenced), {}, at).isFilm).toBeNull();
  });

  it('reads animation from the class list before the genre list', () => {
    const anime: WdEntity = { ...cairoStation, claims: { ...cairoStation.claims, P31: [{ mainsnak: { datavalue: { value: { id: 'Q20650540' } } } }] } };
    expect(factsFromEntity(anime, referencedLookup(referenced), {}, at).genres?.value).toEqual(['Animation', 'Drama']);
  });
});

describe('earliestYear / stripArabicDisambiguation', () => {
  it('takes the earliest plausible P577 year', () => {
    expect(earliestYear(cairoStation)).toBe(1958);
    expect(earliestYear({ id: 'Q1', claims: { P577: [{ mainsnak: { datavalue: { value: { time: '+1200-00-00T00:00:00Z' } } } }] } })).toBeNull();
  });
  it('strips only a trailing film disambiguator', () => {
    expect(stripArabicDisambiguation('باب الحديد (فيلم)')).toBe('باب الحديد');
    expect(stripArabicDisambiguation('باب الحديد (فيلم 1958)')).toBe('باب الحديد');
    expect(stripArabicDisambiguation('الأرض')).toBe('الأرض');
  });
});

describe('buildDiscoverySparql', () => {
  it('asks for films from the given countries with both ids, within the year window and sitelink floor, capped', () => {
    const query = buildDiscoverySparql({ countryQids: ['Q79', 'Q948'], yearFrom: 1950, yearTo: 2000, minSitelinks: 8, limit: 500 });
    expect(query).toContain('VALUES ?country { wd:Q79 wd:Q948 }');
    expect(query).toContain('?film wdt:P345 ?imdb .');
    expect(query).toContain('?film wdt:P4947 ?tmdb .');
    expect(query).toContain('FILTER(?year >= 1950 && ?year <= 2000)');
    expect(query).toContain('FILTER(?sitelinks >= 8)');
    expect(query).toContain('LIMIT 200');
  });

  it('refuses an empty or malformed country list rather than querying the whole of Wikidata', () => {
    expect(() => buildDiscoverySparql({})).toThrow('country QID');
    expect(() => buildDiscoverySparql({ countryQids: ['Egypt'] })).toThrow('country QID');
  });
});

describe('parseDiscoveryBindings', () => {
  const response = {
    results: {
      bindings: [
        { film: { value: 'http://www.wikidata.org/entity/Q765535' }, filmLabel: { value: 'Cairo Station' }, imdb: { value: 'tt0051390' }, tmdb: { value: '47324' }, year: { value: '1958' }, sitelinks: { value: '31' }, langLabel: { value: 'Egyptian Arabic' } },
        { film: { value: 'http://www.wikidata.org/entity/Q765535' }, filmLabel: { value: 'Cairo Station' }, imdb: { value: 'tt0051390' }, tmdb: { value: '47324' }, year: { value: '1958' }, sitelinks: { value: '31' }, langLabel: { value: 'Arabic' } },
        { film: { value: 'http://www.wikidata.org/entity/Q1' }, filmLabel: { value: 'Hollywood Import' }, imdb: { value: 'tt0000001' }, tmdb: { value: '1' }, year: { value: '2001' }, sitelinks: { value: '9' }, langLabel: { value: 'English' } },
      ],
    },
  };

  it('keeps one row per QID, drops excluded original languages, and snapshots the criteria', () => {
    const rows = parseDiscoveryBindings(response, { countryQids: ['Q79'], slice: 'africa', reason: 'gap' }, 'wikidata');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'wikidata', wikidataId: 'Q765535', imdbId: 'tt0051390', tmdbId: '47324', titleEn: 'Cairo Station', year: 1958, sitelinks: 31 });
    expect(rows[0].criteria).toEqual({ slice: 'africa', reason: 'gap', countryQids: ['Q79'] });
  });

  it('keeps English-language films when the caller says so', () => {
    expect(parseDiscoveryBindings(response, { countryQids: ['Q79'], excludeOriginalLanguages: [] }, 'wikidata')).toHaveLength(2);
  });
});

describe('parseWikipediaLead', () => {
  it('returns the lead only for an existing, non-disambiguation page that still points at the expected item', () => {
    const ok = { query: { pages: [{ title: 'Cairo Station', extract: 'Lead text.', pageprops: { wikibase_item: 'Q765535' } }] } };
    expect(parseWikipediaLead(ok, 'Q765535')).toBe('Lead text.');
    expect(parseWikipediaLead(ok, 'Q1')).toBeNull();
    expect(parseWikipediaLead({ query: { pages: [{ title: 'X', missing: true }] } }, 'Q765535')).toBeNull();
    expect(parseWikipediaLead({ query: { pages: [{ title: 'X', extract: 'a', pageprops: { wikibase_item: 'Q765535', disambiguation: '' } }] } }, 'Q765535')).toBeNull();
    expect(parseWikipediaLead(null, 'Q765535')).toBeNull();
  });
});
