import { describe, expect, it } from 'vitest';
import { redactUrl } from './wiki-http';

// P1-1: TMDB's v3 key has no header form, so it stays in the query string and
// the fetch keeps working exactly as before -- what must not happen is the key
// travelling on into an error message or a terminal scrollback with the URL.
describe('redactUrl', () => {
  it('hides a TMDB v3 key while leaving the request readable', () => {
    expect(redactUrl('https://api.themoviedb.org/3/movie/603?api_key=abcd1234secret')).toBe(
      'https://api.themoviedb.org/3/movie/603?api_key=REDACTED',
    );
  });

  it('hides it mid-query and keeps the other parameters', () => {
    expect(redactUrl('https://api.themoviedb.org/3/movie/603?language=ar&api_key=secret&page=2')).toBe(
      'https://api.themoviedb.org/3/movie/603?language=ar&api_key=REDACTED&page=2',
    );
  });

  it('covers the other names a credential travels under', () => {
    expect(redactUrl('https://example.test/x?access_token=t')).toContain('access_token=REDACTED');
    expect(redactUrl('https://example.test/x?TOKEN=t')).toContain('TOKEN=REDACTED');
  });

  it('leaves a URL with no credential exactly as it is', () => {
    const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q765535';
    expect(redactUrl(url)).toBe(url);
  });
});
