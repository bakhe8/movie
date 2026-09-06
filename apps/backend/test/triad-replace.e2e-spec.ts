import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { publishForTest } from './publish-for-test';
import { Title } from '../src/entities/title.entity';
import { TriadReplacement } from '../src/entities/triad-replacement.entity';

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Replace', lastName: label })
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

// The two neutral replacement controls of the triad screen (blueprint §4.3,
// ADR-17) over real HTTP against a real Postgres: the swap itself, the
// exposure bookkeeping each reason implies, the append-only event row, and
// the "nothing left to swap in" path that skips the triad instead.
describe('Triad replacement (real HTTP, real DB)', () => {
  let app: INestApplication;
  let titleIds: string[];
  let replacements: Repository<TriadReplacement>;

  // Four watched titles: three go into the triad, one is the only spare.
  async function startRound() {
    const token = await registerUser(app, 'replace-check');
    const profileId = await createProfile(app, token, 'Replace check');
    await markWatched(app, token, profileId, titleIds);
    const current = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return { token, profileId, triad: current.body as { id: string; titleIds: string[] } };
  }

  async function watchedTitleIds(token: string, profileId: string) {
    const response = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/watched-titles`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body as { titleId: string }[]).map((state) => state.titleId);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    replacements = app.get<Repository<TriadReplacement>>(getRepositoryToken(TriadReplacement));
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save([
      { internalId: `E2E-REPL-A-${suffix}`, titleEn: 'Replace Check A', titleAr: 'أ' },
      { internalId: `E2E-REPL-B-${suffix}`, titleEn: 'Replace Check B', titleAr: 'ب' },
      { internalId: `E2E-REPL-C-${suffix}`, titleEn: 'Replace Check C', titleAr: 'ج' },
      { internalId: `E2E-REPL-D-${suffix}`, titleEn: 'Replace Check D', titleAr: 'د' },
    ]);
    titleIds = titles.map((title) => title.id);
    await publishForTest(app, titleIds); // PUB-G1: the triad flow marks these watched
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('swaps only the named title into the same slot, refreshes displayOrder, logs the event, and clears exposure for not_watched', async () => {
    const { token, profileId, triad } = await startRound();
    const replaced = triad.titleIds[1];
    const spare = titleIds.find((id) => !triad.titleIds.includes(id)) as string;

    const response = await request(app.getHttpServer())
      .post(`/triads/${triad.id}/replace`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId: replaced, reason: 'not_watched' })
      .expect(201);

    expect(response.body.status).toBe('active');
    expect(response.body.titleIds).toEqual([triad.titleIds[0], spare, triad.titleIds[2]]);
    expect([...response.body.displayOrder].sort()).toEqual([...response.body.titleIds].sort());

    const rows = await replacements.find({ where: { triadId: triad.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ replacedTitleId: replaced, replacementTitleId: spare, reason: 'not_watched' });

    // not_watched = exposure unknown: the title leaves the watched set (and
    // so the triad pool) and stays a recommendation candidate (BP §2.4 #3).
    expect(await watchedTitleIds(token, profileId)).not.toContain(replaced);
  });

  it('keeps a not_remembered title watched but out of the pool, and skips the triad when nothing can replace it', async () => {
    const { token, profileId, triad } = await startRound();

    // Use up the single spare first.
    const first = await request(app.getHttpServer())
      .post(`/triads/${triad.id}/replace`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId: triad.titleIds[0], reason: 'not_watched' })
      .expect(201);
    expect(first.body.status).toBe('active');

    const forgotten = first.body.titleIds[1] as string;
    const second = await request(app.getHttpServer())
      .post(`/triads/${triad.id}/replace`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId: forgotten, reason: 'not_remembered' })
      .expect(201);

    // Nothing eligible is left to swap in: the event is still recorded (with
    // no replacement), the triad is abandoned rather than patched.
    expect(second.body.status).toBe('skipped');
    expect(second.body.titleIds).toEqual(first.body.titleIds);
    const rows = await replacements.find({ where: { triadId: triad.id }, order: { createdAt: 'ASC' } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ replacedTitleId: forgotten, replacementTitleId: null, reason: 'not_remembered' });

    // not_remembered keeps the watch (the title is not recommendable) ...
    expect(await watchedTitleIds(token, profileId)).toContain(forgotten);

    // ... but the eligible pool is now two titles, so the next round cannot
    // start and says so with a structured reason the client can act on.
    const next = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/triads/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(next.body.state).toBe('need_more_watched');
    expect(next.body.needed).toBe(1);
  });

  it('rejects a title outside the triad, an unknown reason, and another user\'s triad', async () => {
    const { token, triad } = await startRound();
    const foreignTitle = '00000000-0000-4000-8000-000000000000';

    await request(app.getHttpServer())
      .post(`/triads/${triad.id}/replace`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId: foreignTitle, reason: 'not_watched' })
      .expect(400);

    // There is deliberately no "didn't like it" reason (BP §2.4 #2).
    await request(app.getHttpServer())
      .post(`/triads/${triad.id}/replace`)
      .set('Authorization', `Bearer ${token}`)
      .send({ titleId: triad.titleIds[0], reason: 'disliked' })
      .expect(400);

    const otherToken = await registerUser(app, 'replace-other');
    await request(app.getHttpServer())
      .post(`/triads/${triad.id}/replace`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ titleId: triad.titleIds[0], reason: 'not_watched' })
      .expect(404);

    expect(await replacements.count({ where: { triadId: triad.id } })).toBe(0);
  });

  // H3 (AUDIT_2026-09-05): two concurrent replacements of the same title --
  // a double-click, or a retry sent before the first response arrives --
  // serialize on a row lock inside the transaction. Before it, both passed
  // the checks on one stale read, both drew the spare, and the later save
  // overwrote the earlier swap while its event row still claimed it
  // happened. The invariants hold whichever way the two land: one event
  // row, one swap, and no caller sees a 500.
  it('serializes two concurrent replacements of the same title: one event row, one swap, no 500', async () => {
    const { token, triad } = await startRound();
    const replaced = triad.titleIds[1];
    const spare = titleIds.find((id) => !triad.titleIds.includes(id)) as string;
    const expected = [triad.titleIds[0], spare, triad.titleIds[2]];
    const replace = () =>
      request(app.getHttpServer())
        .post(`/triads/${triad.id}/replace`)
        .set('Authorization', `Bearer ${token}`)
        .send({ titleId: replaced, reason: 'not_watched' });

    const responses = await Promise.all([replace(), replace()]);

    // The winner answers 201 with the swap. The loser is handed the winner's
    // triad (201) when it queued on the lock; if it only reached the database
    // after the winner committed, its pre-transaction check answers 400 --
    // never a 500, and never a second swap.
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses[0]).toBe(201);
    expect([201, 400]).toContain(statuses[1]);
    for (const response of responses.filter((candidate) => candidate.status === 201)) {
      expect(response.body.status).toBe('active');
      expect(response.body.titleIds).toEqual(expected);
    }

    const rows = await replacements.find({ where: { triadId: triad.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ replacedTitleId: replaced, replacementTitleId: spare, reason: 'not_watched' });
  });
});
