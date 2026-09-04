import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';

// ALPHA_PLAN 8.3, the row IMPLEMENTATION_STATUS marked ❌: the *contract* of
// the three read paths, as opposed to their behaviour. The behaviour specs
// (titles-search, triad-rank, triad-replace, recommendations-persistence,
// idor) all drive the happy path with well-formed input; nothing checked what
// these routes do with input a real client will eventually send -- a page past
// the end, a limit of 0, a non-uuid id, a query string with junk in it.
//
// Deliberately not re-covered here, because it already is: Arabic search
// normalisation and the starter list (titles-search), ownership and 404-not-403
// (idor), the ranking rules (triad-rank), and the admin model rollback end to
// end through PATCH /admin/models/:version (model-version-rollback).
describe('Read-path API contract (real HTTP, real DB)', () => {
  let app: INestApplication;
  let token: string;
  let profileId: string;
  let titleId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const saved = await titles.save(
      Array.from({ length: 3 }, (_, index) => ({
        internalId: `E2E-CONTRACT-${suffix}-${index}`,
        titleEn: `Contract ${index}`,
        titleAr: `عقد ${index}`,
      })),
    );
    titleId = saved[0].id;

    const email = `contract-${suffix}-${Math.random().toString(36).slice(2)}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery1', firstName: 'Con', lastName: 'Tract' })
      .expect(201);
    token = registered.body.access_token as string;
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .set(auth())
      .send({ name: 'Contract' })
      .expect(201);
    profileId = profile.body.id as string;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /titles', () => {
    it('answers with the page envelope, not a bare array', async () => {
      const response = await request(app.getHttpServer())
        .get('/titles')
        .set(auth())
        .query({ page: 1, limit: 2 })
        .expect(200);

      expect(response.body).toMatchObject({ page: 1, limit: 2 });
      expect(response.body.items).toHaveLength(2);
      expect(response.body.total).toBeGreaterThanOrEqual(3);
      expect(response.body.totalPages).toBe(Math.ceil(response.body.total / 2));
    });

    it('gives different titles on page 2 than on page 1', async () => {
      const first = await request(app.getHttpServer()).get('/titles').set(auth()).query({ limit: 2, page: 1 });
      const second = await request(app.getHttpServer()).get('/titles').set(auth()).query({ limit: 2, page: 2 });

      const ids = new Set(first.body.items.map((item: { id: string }) => item.id));
      expect(second.body.items.every((item: { id: string }) => !ids.has(item.id))).toBe(true);
    });

    // A page past the end is not an error -- there is simply nothing there.
    it('returns an empty page rather than an error past the last page', async () => {
      const response = await request(app.getHttpServer())
        .get('/titles')
        .set(auth())
        .query({ limit: 2, page: 100_000 })
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBeGreaterThan(0);
    });

    it.each([
      ['a limit of zero', { limit: 0 }],
      ['a limit past the cap', { limit: 101 }],
      ['a page of zero', { page: 0 }],
      ['a non-numeric limit', { limit: 'many' }],
    ])('refuses %s', async (_case, query) => {
      await request(app.getHttpServer()).get('/titles').set(auth()).query(query).expect(400);
    });

    // whitelist + forbidNonWhitelisted: an unknown parameter is a client bug,
    // and silently ignoring it hides the bug until it matters.
    it('refuses an unknown query parameter instead of ignoring it', async () => {
      await request(app.getHttpServer()).get('/titles').set(auth()).query({ orderBy: 'rating' }).expect(400);
    });

    // BP §5.3 / DATA_LICENSING: the fingerprint is a licensed derived asset
    // and external ids are not the client's business. Not omitted from the
    // response -- never fetched.
    it('never carries the fingerprint or external ids', async () => {
      const response = await request(app.getHttpServer()).get('/titles').set(auth()).query({ limit: 1 }).expect(200);

      expect(response.body.items[0]).not.toHaveProperty('fingerprint');
      expect(response.body.items[0]).not.toHaveProperty('externalIds');
    });

    it('requires a token', async () => {
      await request(app.getHttpServer()).get('/titles').expect(401);
    });
  });

  describe('GET /titles/:titleId', () => {
    it('returns the title', async () => {
      const response = await request(app.getHttpServer()).get(`/titles/${titleId}`).set(auth()).expect(200);

      expect(response.body.id).toBe(titleId);
      expect(response.body).not.toHaveProperty('fingerprint');
    });

    // 400 for a malformed id and 404 for a well-formed one that is not there:
    // ParseUUIDPipe rejects before the lookup, so the two are distinguishable
    // to a client debugging its own request.
    it('answers 400 for an id that is not a uuid', async () => {
      await request(app.getHttpServer()).get('/titles/not-a-uuid').set(auth()).expect(400);
    });

    it('answers 404 for a uuid that is not in the catalogue', async () => {
      await request(app.getHttpServer())
        .get('/titles/00000000-0000-4000-8000-000000000000')
        .set(auth())
        .expect(404);
    });
  });

  describe('GET /profiles/:profileId/triads/current', () => {
    // A profile with nothing marked cannot be given a triad, and says so in a
    // shape the client can act on rather than a 4xx it has to interpret.
    it('answers 200 with a need_more_watched state before anything is marked', async () => {
      const response = await request(app.getHttpServer())
        .get(`/profiles/${profileId}/triads/current`)
        .set(auth())
        .expect(200);

      expect(response.body.state).toBe('need_more_watched');
      expect(response.body.needed).toBeGreaterThan(0);
      expect(typeof response.body.message).toBe('string');
    });

    it('answers 400 for a profile id that is not a uuid', async () => {
      await request(app.getHttpServer()).get('/profiles/nope/triads/current').set(auth()).expect(400);
    });
  });

  describe('GET /profiles/:profileId/recommendations', () => {
    // Not an array and not an error: an untrained profile has a state to
    // report, and the client renders that instead of an empty list (ADR-81).
    it('reports a state rather than an empty list before the model exists', async () => {
      const response = await request(app.getHttpServer())
        .get(`/profiles/${profileId}/recommendations`)
        .set(auth())
        .expect(200);

      expect(Array.isArray(response.body)).toBe(false);
      expect(typeof response.body.state).toBe('string');
      expect(response.body.state).not.toBe('ready');
    });

    it.each([
      ['zero', 0],
      ['past the cap of 50', 51],
      ['negative', -1],
    ])('refuses a limit of %s', async (_case, limit) => {
      await request(app.getHttpServer())
        .get(`/profiles/${profileId}/recommendations`)
        .set(auth())
        .query({ limit })
        .expect(400);
    });

    it('accepts a limit at each end of the allowed range', async () => {
      for (const limit of [1, 50]) {
        await request(app.getHttpServer())
          .get(`/profiles/${profileId}/recommendations`)
          .set(auth())
          .query({ limit })
          .expect(200);
      }
    });

    it('requires a token', async () => {
      await request(app.getHttpServer()).get(`/profiles/${profileId}/recommendations`).expect(401);
    });
  });
});
