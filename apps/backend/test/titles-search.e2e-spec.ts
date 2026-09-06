import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';
import { publishForTest } from './publish-for-test';

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Search', lastName: label })
    .expect(201);
  return response.body.access_token as string;
}

// Catalogue search folding (Arabic hamza / taa marbuta / alef maqsura) and
// the diverse starter list (blueprint §4.2), over real HTTP + Postgres --
// the folding lives in a SQL translate(), which no unit test can exercise.
describe('Catalogue search and starter list (real HTTP, real DB)', () => {
  let app: INestApplication;
  let token: string;
  const suffix = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    token = await registerUser(app, 'search-check');

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const saved = await titlesRepository.save([
      { internalId: `E2E-SEARCH-HAMZA-${suffix}`, titleEn: `Dreams ${suffix}`, titleAr: `أحلام ${suffix}`, genres: ['Drama'], releaseYear: 2001 },
      { internalId: `E2E-SEARCH-TAA-${suffix}`, titleEn: `School ${suffix}`, titleAr: `مدرسة ${suffix}`, genres: ['Comedy'], releaseYear: 2002 },
      { internalId: `E2E-SEARCH-MAQSURA-${suffix}`, titleEn: `Mustafa ${suffix}`, titleAr: `مصطفى ${suffix}`, genres: ['Drama'], releaseYear: 2001 },
      // A genre that starts with the same letters as another one of this
      // suffix's titles, to prove the LIKE is bracketed rather than a bare
      // substring match (DiscoverScreen's genre filter, moved server-side).
      { internalId: `E2E-SEARCH-GENRE-PREFIX-${suffix}`, titleEn: `Drama Plus ${suffix}`, titleAr: `دراما بلس ${suffix}`, genres: ['Drama Plus'], releaseYear: 2001 },
    ]);
    // PUB-G1: search and the starter list only return published titles.
    await publishForTest(app, saved.map((title) => title.id));
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  async function search(query: string) {
    const response = await request(app.getHttpServer())
      .get('/titles')
      .query({ query })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body.items as { titleAr: string }[]).map((item) => item.titleAr);
  }

  it('finds «أحلام» when the user types «احلام» (no hamza), and the other way round', async () => {
    expect(await search(`احلام ${suffix}`)).toContain(`أحلام ${suffix}`);
    expect(await search(`أحلام ${suffix}`)).toContain(`أحلام ${suffix}`);
  });

  it('treats taa marbuta / haa and alef maqsura / yaa as the same letter', async () => {
    expect(await search(`مدرسه ${suffix}`)).toContain(`مدرسة ${suffix}`);
    expect(await search(`مصطفي ${suffix}`)).toContain(`مصطفى ${suffix}`);
  });

  it('serves a bounded, genre-diverse starter list without fingerprints', async () => {
    const response = await request(app.getHttpServer())
      .get('/titles/starter')
      .query({ limit: 6 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = response.body as { id: string; genres: string[] | null; fingerprint?: unknown }[];

    expect(items.length).toBeLessThanOrEqual(6);
    expect(items.length).toBeGreaterThan(1);
    // Round-robin across primary genres: the first two picks never share one.
    expect(items[0].genres?.[0]).not.toBe(items[1].genres?.[0]);
    expect(items[0]).not.toHaveProperty('fingerprint');
  });

  it('rejects an out-of-range starter limit and is not confused with a title id', async () => {
    await request(app.getHttpServer())
      .get('/titles/starter')
      .query({ limit: 31 })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  // Coordinator ask: move DiscoverScreen's genre filter from an
  // Array.filter over the client's loaded page to a server-side filter over
  // the whole catalogue.
  it('filters by genre across the whole catalogue, never matching a genre that only shares a prefix', async () => {
    const response = await request(app.getHttpServer())
      .get('/titles')
      .query({ query: `${suffix}`, genre: 'Drama' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const names = (response.body.items as { titleAr: string }[]).map((item) => item.titleAr);

    expect(names).toEqual(expect.arrayContaining([`أحلام ${suffix}`, `مصطفى ${suffix}`]));
    expect(names).not.toContain(`مدرسة ${suffix}`);
    // "Drama Plus" starts with "Drama" -- the LIKE must be comma-bracketed
    // so it never matches as a substring.
    expect(names).not.toContain(`دراما بلس ${suffix}`);
  });

  it('filters by exact release year', async () => {
    const response = await request(app.getHttpServer())
      .get('/titles')
      .query({ query: `${suffix}`, year: 2002 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const names = (response.body.items as { titleAr: string }[]).map((item) => item.titleAr);

    expect(names).toEqual([`مدرسة ${suffix}`]);
  });

  it('combines genre and year with AND', async () => {
    const response = await request(app.getHttpServer())
      .get('/titles')
      .query({ query: `${suffix}`, genre: 'Drama', year: 2001 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const names = (response.body.items as { titleAr: string }[]).map((item) => item.titleAr);

    expect(names).toEqual(expect.arrayContaining([`أحلام ${suffix}`, `مصطفى ${suffix}`]));
    expect(names).toHaveLength(2);
  });

  it('rejects a release year outside the accepted range', async () => {
    await request(app.getHttpServer())
      .get('/titles')
      .query({ year: 1500 })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
