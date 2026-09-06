import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { getConnectionOptions } from '../src/config/database.config';
import { Title } from '../src/entities/title.entity';
import { TitlePoster } from '../src/entities/title-poster.entity';
import { PosterService } from '../src/modules/public-quality/poster.service';

// POSTERS-MULTI P3 (ADR-120): forTitlesMulti's batched read, against real
// Postgres -- against postgres-test with synthetic titles, never the shared
// dev database.
describe('PosterService.forTitlesMulti / attach (postgres-test)', () => {
  let dataSource: DataSource;
  let service: PosterService;
  const suffix = Date.now();

  beforeAll(async () => {
    dataSource = new DataSource({ ...getConnectionOptions(), synchronize: false });
    await dataSource.initialize();
    service = new PosterService(dataSource.getRepository(TitlePoster));
  }, 30_000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('returns a batch of titles ordered by sortOrder, one per title, and skips a title with no rows', async () => {
    const titlesRepository = dataSource.getRepository(Title);
    const titlePostersRepository = dataSource.getRepository(TitlePoster);

    const [withPosters, withoutPosters] = await titlesRepository.save([
      titlesRepository.create({ internalId: `E2E-MULTI-WITH-${suffix}`, titleEn: 'With', titleAr: 'مع', posterPath: '/current.jpg' }),
      titlesRepository.create({ internalId: `E2E-MULTI-WITHOUT-${suffix}`, titleEn: 'Without', titleAr: 'بلا', posterPath: null }),
    ]);
    await titlePostersRepository.save([
      titlePostersRepository.create({ titleId: withPosters.id, posterPath: '/current.jpg', sortOrder: 0 }),
      titlePostersRepository.create({ titleId: withPosters.id, posterPath: '/second.jpg', sortOrder: 1 }),
      titlePostersRepository.create({ titleId: withPosters.id, posterPath: '/third.jpg', sortOrder: 2 }),
    ]);

    const result = await service.forTitlesMulti([withPosters.id, withoutPosters.id]);

    expect(result.get(withPosters.id)?.map((p) => p.posterUrl)).toEqual([
      'https://image.tmdb.org/t/p/w342/current.jpg',
      'https://image.tmdb.org/t/p/w342/second.jpg',
      'https://image.tmdb.org/t/p/w342/third.jpg',
    ]);
    expect(result.get(withPosters.id)?.every((p) => p.posterSource.name === 'tmdb')).toBe(true);
    expect(result.has(withoutPosters.id)).toBe(false);
  });

  it('attach() adds posters alongside the unchanged posterUrl/posterSource, in one batched query for the whole array', async () => {
    const titlesRepository = dataSource.getRepository(Title);
    const titlePostersRepository = dataSource.getRepository(TitlePoster);

    const titles = await titlesRepository.save([
      titlesRepository.create({ internalId: `E2E-ATTACH-A-${suffix}`, titleEn: 'A', titleAr: 'أ', posterPath: '/a.jpg' }),
      titlesRepository.create({ internalId: `E2E-ATTACH-B-${suffix}`, titleEn: 'B', titleAr: 'ب', posterPath: '/b.jpg' }),
      titlesRepository.create({ internalId: `E2E-ATTACH-C-${suffix}`, titleEn: 'C', titleAr: 'ج', posterPath: null }),
    ]);
    await titlePostersRepository.save([
      titlePostersRepository.create({ titleId: titles[0].id, posterPath: '/a.jpg', sortOrder: 0 }),
      titlePostersRepository.create({ titleId: titles[0].id, posterPath: '/a-2.jpg', sortOrder: 1 }),
      titlePostersRepository.create({ titleId: titles[1].id, posterPath: '/b.jpg', sortOrder: 0 }),
    ]);

    const attached = await service.attach(titles as unknown as { id: string; posterPath: string | null }[]);

    expect(attached[0]).toMatchObject({ posterUrl: 'https://image.tmdb.org/t/p/w342/a.jpg' });
    expect(attached[0].posters).toHaveLength(2);
    expect(attached[1]).toMatchObject({ posterUrl: 'https://image.tmdb.org/t/p/w342/b.jpg' });
    expect(attached[1].posters).toHaveLength(1);
    // No title_posters row at all for the third title: posterUrl stays null
    // (unrelated to this feature) and posters is an empty array, not undefined.
    expect(attached[2]).toMatchObject({ posterUrl: null, posters: [] });
  });
});
