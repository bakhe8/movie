import { describe, expect, it } from 'vitest';
import {
  ADVISORY_CODES,
  INTAKE_EVALUATOR_VERSION,
  evaluateIntake,
  findPossibleDuplicate,
  normalizeTitleKey,
  statusFor,
  type IntakeCandidate,
} from './intake-evaluator';

const complete: IntakeCandidate = {
  wikidataId: 'Q765535',
  imdbId: 'tt0051390',
  tmdbId: '47324',
  titleEn: 'Cairo Station',
  titleAr: 'باب الحديد',
  description: 'A newspaper seller becomes obsessed with a drink vendor at Cairo station.',
  releaseYear: 1958,
  expectedYear: 1958,
  genres: ['Drama'],
  posterPath: '/abc123.jpg',
  isFilm: true,
  imdbIdFromTmdb: 'tt0051390',
  fingerprintPresent: true,
};

describe('evaluateIntake', () => {
  it('admits a complete, consistent candidate with no codes at all', () => {
    const result = evaluateIntake(complete);
    expect(result).toEqual({ evaluatorVersion: INTAKE_EVALUATOR_VERSION, blockerCodes: [], blocking: [], advisory: [], admissible: true });
    expect(statusFor(result)).toBe('verified');
  });

  it('requires all three provider ids, each well-formed', () => {
    expect(evaluateIntake({ ...complete, wikidataId: null }).blocking).toContain('IDENTITY_WIKIDATA_MISSING');
    expect(evaluateIntake({ ...complete, imdbId: '' }).blocking).toContain('IDENTITY_IMDB_MISSING');
    expect(evaluateIntake({ ...complete, tmdbId: undefined }).blocking).toContain('IDENTITY_TMDB_MISSING');
    expect(evaluateIntake({ ...complete, wikidataId: 'Q0123' }).blocking).toContain('IDENTITY_FORMAT_INVALID');
    expect(evaluateIntake({ ...complete, imdbId: 'tt123' }).blocking).toContain('IDENTITY_FORMAT_INVALID');
    expect(evaluateIntake({ ...complete, tmdbId: '0' }).blocking).toContain('IDENTITY_FORMAT_INVALID');
  });

  it('refuses when TMDB names a different IMDb id for the same tmdb id, and stays silent when TMDB was not asked', () => {
    expect(evaluateIntake({ ...complete, imdbIdFromTmdb: 'tt9999999' }).blocking).toContain('IDENTITY_CROSS_SOURCE_MISMATCH');
    expect(evaluateIntake({ ...complete, imdbIdFromTmdb: null }).blocking).toContain('IDENTITY_CROSS_SOURCE_MISMATCH');
    expect(evaluateIntake({ ...complete, imdbIdFromTmdb: undefined }).blockerCodes).toEqual([]);
  });

  it('carries fetch-catalog.ts rules: not a film class, year off by more than one', () => {
    expect(evaluateIntake({ ...complete, isFilm: false }).blocking).toContain('NOT_A_FILM');
    expect(evaluateIntake({ ...complete, isFilm: null }).blockerCodes).toEqual([]);
    expect(evaluateIntake({ ...complete, releaseYear: 1959 }).blockerCodes).toEqual([]);
    expect(evaluateIntake({ ...complete, releaseYear: 1960 }).blocking).toContain('YEAR_MISMATCH');
    expect(evaluateIntake({ ...complete, releaseYear: null }).blocking).toContain('YEAR_MISSING');
  });

  it('checks every public-v1 content field early, including the Arabic title, which is never invented', () => {
    const empty = evaluateIntake({ ...complete, titleEn: ' ', titleAr: null, description: '', genres: [], posterPath: null });
    expect(empty.blocking).toEqual(
      expect.arrayContaining(['TITLE_EN_MISSING', 'TITLE_AR_MISSING', 'DESCRIPTION_MISSING', 'GENRES_MISSING', 'POSTER_MISSING']),
    );
    expect(empty.admissible).toBe(false);
    expect(statusFor(empty)).toBe('blocked');
  });

  it('marks stub descriptions, unmapped genres and a missing fingerprint as advisory only', () => {
    const result = evaluateIntake({ ...complete, descriptionIsStub: true, unmappedGenres: ['girls with guns'], fingerprintPresent: false });
    expect(result.advisory).toEqual(['DESCRIPTION_FROM_STUB', 'GENRES_UNMAPPED', 'FINGERPRINT_MISSING']);
    expect(result.blocking).toEqual([]);
    expect(result.admissible).toBe(true);
    for (const code of result.advisory) expect(ADVISORY_CODES.has(code)).toBe(true);
  });

  it('treats an exact duplicate as its own status and a suspected one as blocking for human review', () => {
    const exact = evaluateIntake({ ...complete, duplicateOfTitle: 'DEMO0001' });
    expect(exact.blocking).toContain('DUPLICATE_OF_TITLE');
    expect(statusFor(exact)).toBe('duplicate');
    const suspected = evaluateIntake({ ...complete, possibleDuplicateOf: 'DEMO0002' });
    expect(suspected.blocking).toContain('POSSIBLE_DUPLICATE');
    expect(suspected.admissible).toBe(false);
    expect(statusFor(suspected)).toBe('blocked');
  });

  it('records a failed source fetch as a blocking, transient code', () => {
    const result = evaluateIntake({ ...complete, sourceFetchFailed: true });
    expect(result.blocking).toEqual(['SOURCE_FETCH_FAILED']);
  });

  it('never repeats a code', () => {
    const result = evaluateIntake({ ...complete, wikidataId: 'bad', imdbId: 'bad', tmdbId: 'bad' });
    expect(result.blockerCodes.filter((code) => code === 'IDENTITY_FORMAT_INVALID')).toHaveLength(1);
  });
});

describe('normalizeTitleKey', () => {
  it('folds accents, case, punctuation and a trailing year/film disambiguator', () => {
    expect(normalizeTitleKey('Sátántangó (1994 film)')).toBe('satantango');
    expect(normalizeTitleKey('  The  Night of Counting the Years ')).toBe('the night of counting the years');
    expect(normalizeTitleKey('باب الحديد (فيلم)')).toBe('باب الحديد');
  });
});

describe('findPossibleDuplicate', () => {
  const existing = [
    { key: normalizeTitleKey('Cairo Station'), year: 1958, ref: 'DEMO0001' },
    { key: normalizeTitleKey('The Land'), year: 1970, ref: 'DEMO0003' },
    { key: normalizeTitleKey('Undated'), year: null, ref: 'DEMO0004' },
  ];

  it('flags the same title within a year, in either direction', () => {
    expect(findPossibleDuplicate({ titleEn: 'Cairo station', releaseYear: 1959 }, existing)).toBe('DEMO0001');
    expect(findPossibleDuplicate({ titleEn: 'the land', releaseYear: 1969 }, existing)).toBe('DEMO0003');
  });

  it('does not flag a remake years apart, or a different title', () => {
    expect(findPossibleDuplicate({ titleEn: 'The Land', releaseYear: 2001 }, existing)).toBeNull();
    expect(findPossibleDuplicate({ titleEn: 'Another Film', releaseYear: 1970 }, existing)).toBeNull();
  });

  it('flags when either side has no year, since a missing year is not evidence of difference', () => {
    expect(findPossibleDuplicate({ titleEn: 'Undated', releaseYear: 1990 }, existing)).toBe('DEMO0004');
    expect(findPossibleDuplicate({ titleEn: 'Cairo Station', releaseYear: null }, existing)).toBe('DEMO0001');
  });

  it('is null without a title', () => {
    expect(findPossibleDuplicate({ titleEn: null, releaseYear: 1958 }, existing)).toBeNull();
  });
});
