import { describe, expect, it } from 'vitest';

import { isValidPosterPath, needsPoster, parsePosterImages, parsePosterResponse, selectPosterRows } from './fetch-tmdb-posters.lib';

describe('needsPoster', () => {
  it('is a candidate only with a TMDB id and an unchecked (or forced) poster', () => {
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' } })).toBe(true);
    expect(needsPoster({ internalId: 'x', externalIds: {} })).toBe(false);
    expect(needsPoster({ internalId: 'x' })).toBe(false);
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' }, posterPath: '/abc.jpg' })).toBe(false);
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' }, posterPath: null })).toBe(false); // already checked, TMDB has none
    expect(needsPoster({ internalId: 'x', externalIds: { tmdb: '123' }, posterPath: '/abc.jpg' }, true)).toBe(true);
  });
});

describe('parsePosterResponse', () => {
  it('returns the path TMDB gives, exactly as given', () => {
    expect(parsePosterResponse(200, JSON.stringify({ poster_path: '/abc123.jpg' }))).toBe('/abc123.jpg');
  });

  it('is null, never fabricated, when TMDB reports no poster or the request failed', () => {
    expect(parsePosterResponse(200, JSON.stringify({ poster_path: null }))).toBeNull();
    expect(parsePosterResponse(200, JSON.stringify({}))).toBeNull();
    expect(parsePosterResponse(404, JSON.stringify({ success: false, status_message: 'not found' }))).toBeNull();
    expect(parsePosterResponse(200, 'not json')).toBeNull();
    expect(parsePosterResponse(200, JSON.stringify({ poster_path: '' }))).toBeNull();
  });
});

describe('isValidPosterPath', () => {
  it('accepts a bare TMDB path and rejects anything CHK_title_posters_path would reject', () => {
    expect(isValidPosterPath('/abc123.jpg')).toBe(true);
    expect(isValidPosterPath('/qJ2tW6WMUDux911r6m7haRef0WH.png')).toBe(true);
    expect(isValidPosterPath('https://image.tmdb.org/t/p/original/abc123.jpg')).toBe(false); // a composed URL
    expect(isValidPosterPath('abc123.jpg')).toBe(false); // no leading slash
    expect(isValidPosterPath('/abc/123.jpg')).toBe(false); // a second path segment
    expect(isValidPosterPath('/abc123')).toBe(false); // no extension
    expect(isValidPosterPath('')).toBe(false);
  });
});

describe('parsePosterImages', () => {
  it('returns every poster TMDB reports for /movie/{id}/images', () => {
    const posters = [{ file_path: '/a.jpg', vote_average: 5.5 }, { file_path: '/b.jpg', vote_average: 8.1 }];
    expect(parsePosterImages(200, JSON.stringify({ posters }))).toEqual(posters);
  });

  it('is null, never fabricated, on a failed request or a missing/malformed posters field', () => {
    expect(parsePosterImages(404, JSON.stringify({ success: false, status_message: 'not found' }))).toBeNull();
    expect(parsePosterImages(200, JSON.stringify({}))).toBeNull();
    expect(parsePosterImages(200, JSON.stringify({ posters: 'nope' }))).toBeNull();
    expect(parsePosterImages(200, 'not json')).toBeNull();
  });
});

describe('selectPosterRows', () => {
  it('leads with the current poster at sortOrder 0, then fills by vote_average descending', () => {
    const images = [
      { file_path: '/low.jpg', vote_average: 3 },
      { file_path: '/high.jpg', vote_average: 9 },
      { file_path: '/mid.jpg', vote_average: 6 },
    ];
    expect(selectPosterRows('/current.jpg', images, 4)).toEqual([
      { posterPath: '/current.jpg', sortOrder: 0 },
      { posterPath: '/high.jpg', sortOrder: 1 },
      { posterPath: '/mid.jpg', sortOrder: 2 },
      { posterPath: '/low.jpg', sortOrder: 3 },
    ]);
  });

  it('never lists the current poster twice when TMDB also returns it', () => {
    const images = [
      { file_path: '/current.jpg', vote_average: 1 },
      { file_path: '/high.jpg', vote_average: 9 },
    ];
    expect(selectPosterRows('/current.jpg', images, 4)).toEqual([
      { posterPath: '/current.jpg', sortOrder: 0 },
      { posterPath: '/high.jpg', sortOrder: 1 },
    ]);
  });

  it('starts at 0 from TMDB alone when there is no current poster yet', () => {
    const images = [
      { file_path: '/low.jpg', vote_average: 3 },
      { file_path: '/high.jpg', vote_average: 9 },
    ];
    expect(selectPosterRows(null, images, 4)).toEqual([
      { posterPath: '/high.jpg', sortOrder: 0 },
      { posterPath: '/low.jpg', sortOrder: 1 },
    ]);
  });

  it('caps at limit and drops any path that is not a bare TMDB path', () => {
    const images = [
      { file_path: '/a.jpg', vote_average: 9 },
      { file_path: 'https://image.tmdb.org/t/p/original/b.jpg', vote_average: 8 },
      { file_path: '/c.jpg', vote_average: 7 },
      { file_path: '/d.jpg', vote_average: 6 },
    ];
    expect(selectPosterRows(null, images, 2)).toEqual([
      { posterPath: '/a.jpg', sortOrder: 0 },
      { posterPath: '/c.jpg', sortOrder: 1 },
    ]);
  });

  it('breaks a vote_average tie by path, for a deterministic order', () => {
    const images = [
      { file_path: '/z.jpg', vote_average: 5 },
      { file_path: '/a.jpg', vote_average: 5 },
    ];
    expect(selectPosterRows(null, images, 2).map((r) => r.posterPath)).toEqual(['/a.jpg', '/z.jpg']);
  });
});
