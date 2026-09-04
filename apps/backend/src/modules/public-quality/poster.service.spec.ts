import { beforeEach, describe, expect, it } from 'vitest';
import { PosterService } from './poster.service';

describe('PosterService', () => {
  let service: PosterService;

  beforeEach(() => {
    service = new PosterService();
  });

  it('composes the served URL from the stored path and credits TMDB', async () => {
    const posters = await service.forTitles([{ id: 't1', posterPath: '/abc.jpg' }]);

    expect(posters.get('t1')).toEqual({
      posterUrl: 'https://image.tmdb.org/t/p/w342/abc.jpg',
      posterSource: { name: 'tmdb', attribution: expect.stringContaining('TMDB') },
    });
  });

  // Owner decision 2026-09-05 (board 13), DATA_LICENSING.md §0: licensing is
  // not a display gate while the service earns nothing -- a stored path is
  // the whole condition, and no rights-registry lookup happens on the read
  // path. The service takes no repository at all, so this cannot regress
  // quietly.
  it('needs nothing but the path: no rights-registry dependency on the read path', async () => {
    expect(PosterService.length).toBe(0);

    const posters = await service.forTitles([
      { id: 't1', posterPath: '/a.jpg' },
      { id: 't2', posterPath: '/b.jpg' },
    ]);

    expect([...posters.keys()]).toEqual(['t1', 't2']);
  });

  it('leaves a title without a path out of the map', async () => {
    const posters = await service.forTitles([
      { id: 't1', posterPath: null },
      { id: 't2', posterPath: '' },
      { id: 't3' },
    ]);

    expect(posters.size).toBe(0);
  });

  it('attaches explicit nulls rather than dropping a title that has no poster', async () => {
    expect(await service.attach([{ id: 't1', posterPath: null }, { id: 't2', posterPath: '/b.jpg' }])).toEqual([
      { id: 't1', posterPath: null, posterUrl: null, posterSource: null },
      {
        id: 't2',
        posterPath: '/b.jpg',
        posterUrl: 'https://image.tmdb.org/t/p/w342/b.jpg',
        posterSource: { name: 'tmdb', attribution: expect.stringContaining('TMDB') },
      },
    ]);
  });
});
