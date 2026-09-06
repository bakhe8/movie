import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';
import { UserTitleState } from '../src/entities/user-title-state.entity';
import { publishForTest } from './publish-for-test';

const PASSWORD = 'CorrectHorseBattery1';

// PUB-G1 (board 1D-7), the write half: a staged title is not writable
// either. Marking one watched/watchlisted, or recording a watch event
// against it, is how an unpublished row would otherwise walk itself into
// the funnel -- from `user_title_states` it reaches the triad pool and the
// library. The read half is publication-guard.e2e-spec.ts.
describe('Publication guard on the state/watch-event write paths', () => {
  let app: INestApplication;
  let token: string;
  let profileId: string;
  let titles: Repository<Title>;
  let states: Repository<UserTitleState>;
  let stagedId: string;
  let publishedId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    states = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `guard-write-${suffix}@example.com`, password: PASSWORD, firstName: 'Gua', lastName: 'Rd' })
      .expect(201);
    token = registered.body.access_token as string;
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'GuardWrite' })
      .expect(201);
    profileId = profile.body.id as string;

    const [staged, published] = await titles.save([
      {
        internalId: `E2E-GUARDW-STAGED-${suffix}`,
        titleEn: `Staged Write ${suffix}`,
        titleAr: `مرحلي ${suffix}`,
        description: 'A complete description.',
        genres: ['Drama'],
        posterPath: '/staged.jpg',
      },
      {
        internalId: `E2E-GUARDW-PUBLISHED-${suffix}`,
        titleEn: `Published Write ${suffix}`,
        titleAr: `منشور ${suffix}`,
        description: 'A complete description.',
        genres: ['Drama'],
        posterPath: '/published.jpg',
      },
    ]);
    stagedId = staged.id;
    publishedId = published.id;
    await publishForTest(app, [publishedId]);
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('refuses to mark an unpublished title watched, and writes no state row', async () => {
    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${stagedId}/state`)
      .set(auth())
      .send({ state: 'watched' })
      .expect(404);

    expect(await states.findOne({ where: { profileId, titleId: stagedId } })).toBeNull();
  });

  it('refuses to put an unpublished title on the watchlist', async () => {
    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${stagedId}/state`)
      .set(auth())
      .send({ state: 'watchlist' })
      .expect(404);

    expect(await states.findOne({ where: { profileId, titleId: stagedId } })).toBeNull();
  });

  it('refuses a watch event against an unpublished title', async () => {
    await request(app.getHttpServer())
      .post(`/profiles/${profileId}/watch-events`)
      .set(auth())
      .send({ titleId: stagedId, source: 'in_app' })
      .expect(404);
  });

  it('still allows both writes against a published title', async () => {
    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${publishedId}/state`)
      .set(auth())
      .send({ state: 'watched' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/profiles/${profileId}/watch-events`)
      .set(auth())
      .send({ titleId: publishedId, source: 'in_app' })
      .expect(201);

    expect(await states.findOne({ where: { profileId, titleId: publishedId } })).toMatchObject({ state: 'watched' });
  });

  // The guard stops new exposure; it must not rewrite history a profile
  // already holds (same exception as usualRegion/rankLibrary).
  it('keeps a title the profile already holds visible in its own library after it is unpublished', async () => {
    await titles.update({ id: publishedId }, { publishedRevisionId: null });

    const watched = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/watched-titles`)
      .set(auth())
      .expect(200);

    expect((watched.body as { titleId: string }[]).map((row) => row.titleId)).toContain(publishedId);

    // Restored so the fixture leaves nothing half-published behind it.
    await publishForTest(app, [publishedId]);
  });
});
