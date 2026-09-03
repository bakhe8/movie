import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Rank', lastName: label })
    .expect(201);
  return response.body.access_token as string;
}

async function createProfile(app: INestApplication, token: string, label: string) {
  const response = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `${label} ${Date.now()}` })
    .expect(201);
  return response.body.id as string;
}

async function markWatched(app: INestApplication, token: string, profileId: string, titleIds: string[]) {
  for (const titleId of titleIds) {
    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched' })
      .expect(200);
  }
}

// Exercises the gap-3 rework (ADR-32) over real HTTP against a real Postgres:
// ranking submitted as title ids rather than indices, and Idempotency-Key
// retry safety. idor.e2e-spec.ts deliberately never completes a rank (its
// own scope is auth guards/ownership only), so this is the only place the
// full register -> mark watched -> rank flow runs end to end.
describe('Triad ranking (real HTTP, real DB)', () => {
  let app: INestApplication;
  let titleIds: string[];

  async function registerAndCreateProfile() {
    const token = await registerUser(app, 'rank-check');
    const profileId = await createProfile(app, token, 'Rank check');
    await markWatched(app, token, profileId, titleIds);
    return { token, profileId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save([
      { internalId: `E2E-RANK-A-${suffix}`, titleEn: 'Rank Check A', titleAr: 'أ' },
      { internalId: `E2E-RANK-B-${suffix}`, titleEn: 'Rank Check B', titleAr: 'ب' },
      { internalId: `E2E-RANK-C-${suffix}`, titleEn: 'Rank Check C', titleAr: 'ج' },
    ]);
    titleIds = titles.map((title) => title.id);
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('accepts a title-id ranking, completes the triad, and records answeredAt', async () => {
    const { token, profileId } = await registerAndCreateProfile();

    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(current.body.status).toBe('active');
    expect(current.body.shownAt).not.toBeNull();
    // The three titles come inline, in displayOrder, public columns only --
    // the screen never fetches them one by one.
    const items = current.body.items as { id: string; titleAr: string; fingerprint?: unknown }[];
    expect(items.map((item) => item.id)).toEqual(current.body.displayOrder);
    expect(items[0].titleAr).toBeTruthy();
    expect(items[0]).not.toHaveProperty('fingerprint');
    const [first, second, third] = current.body.titleIds as string[];

    const ranked = await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ranking: [third, first, second] })
      .expect(201);

    expect(ranked.body.status).toBe('completed');
    expect(ranked.body.ranking).toEqual([third, first, second]);
    expect(ranked.body.answeredAt).not.toBeNull();
  });

  it('rejects a ranking that uses a title id outside the triad', async () => {
    const { token, profileId } = await registerAndCreateProfile();
    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const foreignId = '00000000-0000-4000-8000-000000000000';

    await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ranking: [foreignId, current.body.titleIds[0], current.body.titleIds[1]] })
      .expect(400);
  });

  it('returns the same result on a retried request with the same Idempotency-Key, not an error', async () => {
    const { token, profileId } = await registerAndCreateProfile();
    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ranking = [...(current.body.titleIds as string[])];
    // A fresh key per run: postgres-test's tmpfs volume survives a
    // stop/start cycle of the same container (only a true recreate wipes
    // it), so a hard-coded key here would collide with a leftover row from
    // an earlier run and turn this into an accidental idempotencyKey-reuse
    // conflict (409) instead of testing a real retry.
    const idempotencyKey = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ranking })
      .expect(201);

    const retry = await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ ranking })
      .expect(201);

    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.answeredAt).toBe(first.body.answeredAt);
  });

  // H1: getCurrent() used to exclude every title that had ever appeared in
  // any completed triad for the profile, so a title could enter at most one
  // triad, ever -- with exactly 6 watched titles a third triad was
  // impossible even though only the second triad's 3 titles were "just
  // used". Now only the immediately previous triad is excluded, so round 3
  // must land back on round 1's titles.
  it('reuses a title from an earlier (non-immediately-previous) triad instead of excluding it forever', async () => {
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const sixTitles = await titlesRepository.save([
      { internalId: `E2E-H1-A-${suffix}`, titleEn: 'H1 Check A', titleAr: 'أ' },
      { internalId: `E2E-H1-B-${suffix}`, titleEn: 'H1 Check B', titleAr: 'ب' },
      { internalId: `E2E-H1-C-${suffix}`, titleEn: 'H1 Check C', titleAr: 'ج' },
      { internalId: `E2E-H1-D-${suffix}`, titleEn: 'H1 Check D', titleAr: 'د' },
      { internalId: `E2E-H1-E-${suffix}`, titleEn: 'H1 Check E', titleAr: 'هـ' },
      { internalId: `E2E-H1-F-${suffix}`, titleEn: 'H1 Check F', titleAr: 'و' },
    ]);
    const sixTitleIds = new Set(sixTitles.map((title) => title.id));

    const token = await registerUser(app, 'h1-check');
    const profileId = await createProfile(app, token, 'H1 check');
    await markWatched(app, token, profileId, [...sixTitleIds]);

    async function rankCurrent(): Promise<Set<string>> {
      const current = await request(app.getHttpServer())
        .get(`/profiles/${profileId}/triads/current`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const usedTitleIds: string[] = current.body.titleIds;
      await request(app.getHttpServer())
        .post(`/triads/${current.body.id}/rank`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ranking: usedTitleIds })
        .expect(201);
      return new Set(usedTitleIds);
    }

    const round1 = await rankCurrent();
    const round2 = await rankCurrent();
    // With exactly 6 watched titles and round 2 forced to avoid round 1's 3
    // (the only 3 left unexcluded), round 1 and round 2 are already known to
    // be complementary halves of the 6 -- this just documents that.
    expect(round1.union(round2)).toEqual(sixTitleIds);

    // Before the H1 fix this would 400 with "mark at least three films" --
    // all 6 titles would already be permanently excluded by rounds 1 and 2.
    const round3 = await rankCurrent();
    expect(round3).toEqual(round1);
  });
});
