import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { publishForTest } from './publish-for-test';
import { Outcome } from '../src/entities/outcome.entity';
import { Recommendation } from '../src/entities/recommendation.entity';
import { Title } from '../src/entities/title.entity';
import { UserTitleState } from '../src/entities/user-title-state.entity';
import { WatchEvent } from '../src/entities/watch-event.entity';

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
    await publishForTest(app, titleIds); // PUB-G1: these get marked watched to build triads
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

    // ADR-119: completing the triad confirms all three titles watched and
    // records why -- against the real DB, so the migration and the partial
    // unique index actually run, not just the mocked unit tests.
    const watchEventsRepository = app.get<Repository<WatchEvent>>(getRepositoryToken(WatchEvent));
    const events = await watchEventsRepository.find({ where: { profileId, source: 'triad_ranked' } });
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.triadId === current.body.id && event.watchedAt === null)).toBe(true);
    expect(new Set(events.map((event) => event.titleId))).toEqual(new Set([first, second, third]));

    const statesRepository = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
    const states = await statesRepository.find({ where: { profileId } });
    expect(states.every((state) => state.state === 'watched')).toBe(true);
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
    // ADR-119, real-DB edge case the unit tests can only mock: the first of
    // the three is explicitly marked not_watched (a different tab, a change
    // of mind) after entering this active triad but before it is ranked. A
    // ranking is stronger evidence than the exposure list, so it must win --
    // this title comes back as watched rather than rank() trusting a stale
    // titleIds array against a state row that has since moved on.
    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${ranking[0]}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'not_watched' })
      .expect(200);
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

    const statesRepository = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
    const revertedState = await statesRepository.findOne({ where: { profileId, titleId: ranking[0] } });
    expect(revertedState?.state).toBe('watched');

    // The replay must not have written a second round of provenance events --
    // still exactly one triad_ranked watch_event per title, not two.
    const watchEventsRepository = app.get<Repository<WatchEvent>>(getRepositoryToken(WatchEvent));
    const events = await watchEventsRepository.find({ where: { profileId, source: 'triad_ranked' } });
    expect(events).toHaveLength(3);
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
    await publishForTest(app, sixTitles.map((title) => title.id)); // PUB-G1
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

  // BP §4.5's "compare prediction to real ranking" arrow (blueprint gap 4,
  // ranked_later, ADR-68): a title that was previously recommended gets an
  // outcomes row the moment it's ranked in a completed triad, with the
  // recommendation it traces back to and its position in the final order.
  it('writes a ranked_later outcome, linking the recommendation, when a previously-recommended title gets ranked', async () => {
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const threeTitles = await titlesRepository.save([
      { internalId: `E2E-RANKEDLATER-A-${suffix}`, titleEn: 'Ranked Later A', titleAr: 'أ' },
      { internalId: `E2E-RANKEDLATER-B-${suffix}`, titleEn: 'Ranked Later B', titleAr: 'ب' },
      { internalId: `E2E-RANKEDLATER-C-${suffix}`, titleEn: 'Ranked Later C', titleAr: 'ج' },
    ]);
    const threeTitleIds = threeTitles.map((title) => title.id);
    await publishForTest(app, threeTitleIds); // PUB-G1

    const token = await registerUser(app, 'ranked-later-check');
    const profileId = await createProfile(app, token, 'Ranked later check');
    await markWatched(app, token, profileId, threeTitleIds);

    // Only one of the three was ever recommended -- the other two should
    // write nothing (the common case: most triads are drawn from watched
    // titles with no recommendation history at all).
    const recommendationsRepository = app.get<Repository<Recommendation>>(getRepositoryToken(Recommendation));
    const recommendation = await recommendationsRepository.save({
      requestId: '33333333-3333-3333-3333-333333333333',
      profileId,
      titleId: threeTitleIds[0],
      track: 'safe',
      confidenceBand: 'strong',
      reason: { features: [], evidenceSource: 'individual' },
      evidenceSource: 'individual',
      modelVersion: 'e2e-ranked-later-v1',
      policyVersion: 'e2e-ranked-later-v1',
      selectionPropensity: 1,
      shownAt: new Date(),
    });

    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Ranked worst-first-to-best-last on purpose so the recommended title
    // (index 0 of threeTitleIds) lands at a distinctive, checkable position
    // rather than accidentally matching the triad's own draw order.
    const ranking = [...(current.body.titleIds as string[])].sort(
      (a, b) => (a === threeTitleIds[0] ? 1 : 0) - (b === threeTitleIds[0] ? 1 : 0),
    );
    const expectedRankPosition = ranking.indexOf(threeTitleIds[0]);

    await request(app.getHttpServer())
      .post(`/triads/${current.body.id}/rank`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ranking })
      .expect(201);

    const outcomesRepository = app.get<Repository<Outcome>>(getRepositoryToken(Outcome));
    const rows = await outcomesRepository.find({ where: { recommendationId: recommendation.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'ranked_later', triadId: current.body.id, rankPosition: expectedRankPosition });

    // The other two titles were never recommended -- no outcomes for them.
    const allOutcomesForTriad = await outcomesRepository.find({ where: { triadId: current.body.id } });
    expect(allOutcomesForTriad).toHaveLength(1);
  });
});
