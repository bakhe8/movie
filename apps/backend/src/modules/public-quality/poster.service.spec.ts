import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosterService } from './poster.service';

describe('PosterService', () => {
  let titlePostersRepository: { find: ReturnType<typeof vi.fn> };
  let service: PosterService;

  beforeEach(() => {
    titlePostersRepository = { find: vi.fn().mockResolvedValue([]) };
    service = new PosterService(titlePostersRepository as never);
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
  // the whole condition, and no rights-registry lookup happens on this read
  // path. `forTitles` alone never touches the injected repository (P3 added
  // one, for the batched multi-poster read below, but never a rights
  // registry), so this cannot regress quietly.
  it('needs nothing but the path: forTitles alone never queries the database', async () => {
    const posters = await service.forTitles([
      { id: 't1', posterPath: '/a.jpg' },
      { id: 't2', posterPath: '/b.jpg' },
    ]);

    expect([...posters.keys()]).toEqual(['t1', 't2']);
    expect(titlePostersRepository.find).not.toHaveBeenCalled();
  });

  it('leaves a title without a path out of the map', async () => {
    const posters = await service.forTitles([
      { id: 't1', posterPath: null },
      { id: 't2', posterPath: '' },
      { id: 't3' },
    ]);

    expect(posters.size).toBe(0);
  });

  it('attaches explicit nulls rather than dropping a title that has no poster, and an empty posters array', async () => {
    expect(await service.attach([{ id: 't1', posterPath: null }, { id: 't2', posterPath: '/b.jpg' }])).toEqual([
      { id: 't1', posterPath: null, posterUrl: null, posterSource: null, posters: [] },
      {
        id: 't2',
        posterPath: '/b.jpg',
        posterUrl: 'https://image.tmdb.org/t/p/w342/b.jpg',
        posterSource: { name: 'tmdb', attribution: expect.stringContaining('TMDB') },
        posters: [],
      },
    ]);
  });

  describe('forTitlesMulti', () => {
    it('runs one query for every title (never one per title) and groups by titleId, ordered by sortOrder', async () => {
      titlePostersRepository.find.mockResolvedValue([
        { titleId: 't1', posterPath: '/t1-0.jpg', sortOrder: 0 },
        { titleId: 't1', posterPath: '/t1-1.jpg', sortOrder: 1 },
        { titleId: 't2', posterPath: '/t2-0.jpg', sortOrder: 0 },
      ]);

      const result = await service.forTitlesMulti(['t1', 't2', 't3']);

      expect(titlePostersRepository.find).toHaveBeenCalledTimes(1);
      expect(result.get('t1')).toEqual([
        { posterUrl: 'https://image.tmdb.org/t/p/w342/t1-0.jpg', posterSource: { name: 'tmdb', attribution: expect.stringContaining('TMDB') } },
        { posterUrl: 'https://image.tmdb.org/t/p/w342/t1-1.jpg', posterSource: { name: 'tmdb', attribution: expect.stringContaining('TMDB') } },
      ]);
      expect(result.get('t2')).toHaveLength(1);
      expect(result.has('t3')).toBe(false); // no title_posters row: absent, not an empty array in the map
    });

    it('never queries the database for an empty batch', async () => {
      const result = await service.forTitlesMulti([]);

      expect(result.size).toBe(0);
      expect(titlePostersRepository.find).not.toHaveBeenCalled();
    });

    it('attach() folds forTitlesMulti in as the posters field, batched for the whole array in one call', async () => {
      titlePostersRepository.find.mockResolvedValue([{ titleId: 't1', posterPath: '/t1-0.jpg', sortOrder: 0 }]);

      const attached = await service.attach([
        { id: 't1', posterPath: '/t1-0.jpg' },
        { id: 't2', posterPath: null },
      ]);

      expect(titlePostersRepository.find).toHaveBeenCalledTimes(1);
      expect(attached[0].posters).toEqual([{ posterUrl: 'https://image.tmdb.org/t/p/w342/t1-0.jpg', posterSource: expect.any(Object) }]);
      expect(attached[1].posters).toEqual([]);
    });
  });
});
