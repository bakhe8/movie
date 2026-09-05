import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';
import { UserTitleState } from '../src/entities/user-title-state.entity';

async function registerAndCreateProfile(app: INestApplication) {
  const email = `m1-state-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const registerResponse = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'M1', lastName: 'State' })
    .expect(201);
  const token = registerResponse.body.access_token as string;

  const profileResponse = await request(app.getHttpServer())
    .post('/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `M1 profile ${Date.now()}` })
    .expect(201);

  return { token, profileId: profileResponse.body.id as string };
}

// M1 (an independent audit's finding): PATCH .../titles/:titleId/state used
// to overwrite `notes` unconditionally (`dto.notes ?? null`) even when the
// caller's body omitted the field entirely, and stored a supplied
// `watchedAt` regardless of the target state. ADR-104/DATE-01 added the same
// PATCH-semantics guarantee for `watchedOn` (a notes-only PATCH must never
// move a date it did not touch). Real HTTP round trips against real
// Postgres, not just a unit-level mock, since the bug is specifically about
// what a PATCH does and doesn't touch.
describe('Watch state PATCH semantics (M1)', () => {
  let app: INestApplication;
  let titleId: string;
  let states: Repository<UserTitleState>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    states = app.get<Repository<UserTitleState>>(getRepositoryToken(UserTitleState));
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const title = await titlesRepository.save({
      internalId: `E2E-M1-${suffix}`,
      titleEn: 'M1 Check',
      titleAr: 'فحص',
    });
    titleId = title.id;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('does not wipe notes on a PATCH that omits the field', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: 'loved the score' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watchlist' })
      .expect(200);

    expect(second.body.notes).toBe('loved the score');
  });

  it('clears notes when the caller explicitly sends null', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: 'temporary note' })
      .expect(200);

    const cleared = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: null })
      .expect(200);

    expect(cleared.body.notes).toBeNull();
  });

  it('ignores a supplied watchedOn when the target state is not watched', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    const response = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watchlist', watchedOn: '2020-01-01' })
      .expect(200);

    expect(response.body.watchedAt).toBeNull();
    expect(response.body.watchedOn).toBeNull();
  });

  // One shared registration for both assertions -- /auth/register is
  // throttled to 5/min per IP, and this file already spends its budget on
  // the other cases below.
  it('validates watchedOn, and a notes-only PATCH never moves an already-recorded one (DATE-01)', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', watchedOn: '2020-01-01T00:00:00.000Z' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', watchedOn: '2026-09-01' })
      .expect(200);

    // DATE-01's second live bug: editing the diary's note alone moved the
    // watched date, because the old PATCH always resent a reconstructed
    // watchedAt regardless of whether the date field was touched.
    const afterDiary = await request(app.getHttpServer())
      .patch(`/profiles/${profileId}/titles/${titleId}/state`)
      .set('Authorization', `Bearer ${token}`)
      .send({ state: 'watched', notes: 'rewatch for the twist' })
      .expect(200);

    expect(afterDiary.body.watchedOn).toBe('2026-09-01');
  });

  // H2 (AUDIT_2026-09-05): concurrent first writes for the same (profile,
  // title) -- a double-fired PATCH, or a watch event racing the screen's own
  // PATCH -- all pass the find-then-create check, and the unique constraint
  // refuses every INSERT but the first. That used to surface as a raw 500;
  // the losers now apply their PATCH on top of the winner's row. Four at
  // once, so the race is actually exercised rather than merely possible.
  it('answers every one of four concurrent first writes for the same title with 200 and keeps exactly one row', async () => {
    const { token, profileId } = await registerAndCreateProfile(app);
    const notes = ['one', 'two', 'three', 'four'];
    const write = (note: string) =>
      request(app.getHttpServer())
        .patch(`/profiles/${profileId}/titles/${titleId}/state`)
        .set('Authorization', `Bearer ${token}`)
        .send({ state: 'watched', notes: note });

    const responses = await Promise.all(notes.map(write));

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const rows = await states.find({ where: { profileId, titleId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('watched');
    expect(rows[0].watchedAt).toBeInstanceOf(Date);
    expect(notes).toContain(rows[0].notes);
  });
});
