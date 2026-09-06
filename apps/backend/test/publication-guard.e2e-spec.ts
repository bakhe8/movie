import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';
import { publishForTest } from './publish-for-test';

const PASSWORD = 'CorrectHorseBattery1';

// PUB-G1 (ADR-118, board 1D-7) end to end: a title with no
// `publishedRevisionId` is absent from every public catalogue surface, and
// appears on all of them the moment it is published. The unit tests prove
// the guard builds the right condition; this proves the condition is
// actually reaching the database on each route.
describe('Publication guard on the public read paths', () => {
  let app: INestApplication;
  let token: string;
  let titles: Repository<Title>;
  let stagedId: string;
  let stagedTitleEn: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    stagedTitleEn = `Staged Guard Check ${suffix}`;

    const email = `guard-${suffix}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD, firstName: 'Gua', lastName: 'Rd' })
      .expect(201);
    token = registered.body.access_token as string;

    // Complete enough to pass public-v1 -- the only thing keeping it out of
    // the catalogue is that nobody has published it.
    const staged = await titles.save({
      internalId: `E2E-GUARD-STAGED-${suffix}`,
      titleEn: stagedTitleEn,
      titleAr: `مرحلي ${suffix}`,
      description: 'A complete description.',
      genres: ['Drama'],
      posterPath: '/staged.jpg',
    });
    stagedId = staged.id;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function searchHits(): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .get('/titles')
      .query({ query: stagedTitleEn })
      .set(auth())
      .expect(200);
    return (response.body.items as { id: string }[]).map((item) => item.id);
  }

  it('hides an unpublished title from search', async () => {
    expect(await searchHits()).not.toContain(stagedId);
  });

  it('answers 404 for an unpublished title even when its UUID is known', async () => {
    await request(app.getHttpServer()).get(`/titles/${stagedId}`).set(auth()).expect(404);
  });

  it('keeps an unpublished title out of the starter list', async () => {
    const response = await request(app.getHttpServer()).get('/titles/starter').set(auth()).expect(200);
    expect((response.body as { id: string }[]).map((item) => item.id)).not.toContain(stagedId);
  });

  it('shows the same title on every one of those surfaces once it is published', async () => {
    await publishForTest(app, [stagedId]);

    expect(await searchHits()).toContain(stagedId);

    const detail = await request(app.getHttpServer()).get(`/titles/${stagedId}`).set(auth()).expect(200);
    expect(detail.body.id).toBe(stagedId);
  });

  it('hides it again if the pointer is cleared', async () => {
    await titles.update({ id: stagedId }, { publishedRevisionId: null });

    expect(await searchHits()).not.toContain(stagedId);
    await request(app.getHttpServer()).get(`/titles/${stagedId}`).set(auth()).expect(404);
  });
});
