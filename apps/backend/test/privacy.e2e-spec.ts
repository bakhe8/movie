import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { AuditLog } from '../src/entities/audit-log.entity';
import { Consent } from '../src/entities/consent.entity';
import { PrivacyRequest } from '../src/entities/privacy-request.entity';
import { Profile } from '../src/entities/profile.entity';
import { Title } from '../src/entities/title.entity';
import { Triad } from '../src/entities/triad.entity';
import { User } from '../src/entities/user.entity';
import { PrivacyService, subjectKeyFor } from '../src/modules/privacy/privacy.service';

const PASSWORD = 'CorrectHorseBattery1';

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: PASSWORD, firstName: 'Privacy', lastName: label })
    .expect(201);
  return { token: response.body.access_token as string, email, userId: response.body.user.id as string };
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
      .send({ state: 'watched', notes: 'kept through a reset' })
      .expect(200);
  }
}

async function completeOneRound(app: INestApplication, token: string, profileId: string) {
  const current = await request(app.getHttpServer())
    .get(`/profiles/${profileId}/triads/current`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const triad = current.body as { id: string; titleIds: string[] };
  await request(app.getHttpServer())
    .post(`/triads/${triad.id}/rank`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ranking: [...triad.titleIds] })
    .expect(201);
  return triad.id;
}

// PRIVACY.md §5 and §10, BP §18.1 ("delete and export tested end to end"):
// real HTTP, real Postgres, every step leaves its privacy_requests and
// audit_log rows.
describe('Privacy rights: export, reset, delete (real HTTP, real DB)', () => {
  let app: INestApplication;
  let titleIds: string[];
  let owner: { token: string; email: string; userId: string };
  let ownerProfileId: string;
  let attacker: { token: string; email: string; userId: string };
  let requests: Repository<PrivacyRequest>;
  let audit: Repository<AuditLog>;
  let profiles: Repository<Profile>;
  let users: Repository<User>;
  let consents: Repository<Consent>;
  let triads: Repository<Triad>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    requests = app.get<Repository<PrivacyRequest>>(getRepositoryToken(PrivacyRequest));
    audit = app.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    consents = app.get<Repository<Consent>>(getRepositoryToken(Consent));
    profiles = app.get<Repository<Profile>>(getRepositoryToken(Profile));
    users = app.get<Repository<User>>(getRepositoryToken(User));
    triads = app.get<Repository<Triad>>(getRepositoryToken(Triad));

    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save(
      Array.from({ length: 3 }, (_, index) => ({
        internalId: `E2E-PRIVACY-${suffix}-${index}`,
        titleEn: `Privacy Check ${index}`,
        titleAr: `فحص الخصوصية ${index}`,
      })),
    );
    titleIds = titles.map((title) => title.id);

    owner = await registerUser(app, 'owner');
    ownerProfileId = await createProfile(app, owner.token, 'Privacy owner');
    await markWatched(app, owner.token, ownerProfileId, titleIds);
    await completeOneRound(app, owner.token, ownerProfileId);
    // A real consent row, so the purge below has something to leave behind.
    await request(app.getHttpServer())
      .put('/consents')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ consents: [{ purpose: 'watch_history', version: 'privacy-2.0', granted: true }] })
      .expect(200);
    attacker = await registerUser(app, 'attacker');
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  describe('export', () => {
    it('refuses a wrong password (403 with a reason) and audits the attempt', async () => {
      const response = await request(app.getHttpServer())
        .post('/privacy/export')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: 'not-my-password' })
        .expect(403);
      expect(response.body).toMatchObject({ reason: 'reverification_failed' });
      const failed = await audit.findOne({ where: { actorUserId: owner.userId, action: 'privacy.export', status: 'failed' } });
      expect(failed).not.toBeNull();
      expect(failed?.reason).toBe('reverification_failed');
    });

    it('returns the portable copy of everything and records the request', async () => {
      const response = await request(app.getHttpServer())
        .post('/privacy/export')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: PASSWORD })
        .expect(200);
      const document = response.body;
      expect(document.meta).toMatchObject({ format: 'movie-export-v1' });
      expect(document.account).toMatchObject({ id: owner.userId, email: owner.email });
      expect(document.account.password).toBeUndefined();
      expect(document.profiles).toHaveLength(1);
      const [profile] = document.profiles;
      expect(profile.profile.id).toBe(ownerProfileId);
      expect(profile.titleStates).toHaveLength(3);
      expect(profile.titleStates[0].title).toMatchObject({ titleEn: expect.stringContaining('Privacy Check') });
      expect(profile.titleStates[0].notes).toBe('kept through a reset');
      expect(profile.triads).toHaveLength(1);
      expect(profile.triads[0]).toMatchObject({ status: 'completed', replacements: [] });
      expect(Array.isArray(document.consents)).toBe(true);
      expect(document.privacyRequests).toHaveLength(1);
      expect(document.privacyRequests[0]).toMatchObject({ type: 'export', status: 'done', id: document.meta.requestId });

      const row = await requests.findOne({ where: { id: document.meta.requestId } });
      expect(row).toMatchObject({ userId: owner.userId, type: 'export', status: 'done', subjectKey: subjectKeyFor(owner.userId) });
      expect(row?.executionLog).toMatchObject({ profiles: 1, triads: 1, delivery: 'inline' });
      const audited = await audit.findOne({ where: { actorUserId: owner.userId, action: 'privacy.export', status: 'ok' } });
      expect(audited?.resourceId).toBe(owner.userId);
    });
  });

  describe('reset', () => {
    it('hides another user\'s profile (404)', async () => {
      await request(app.getHttpServer())
        .post('/privacy/reset')
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ profileId: ownerProfileId })
        .expect(404);
    });

    it('removes the learned taste and keeps the account, consents and watch history', async () => {
      const response = await request(app.getHttpServer())
        .post('/privacy/reset')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ profileId: ownerProfileId })
        .expect(200);
      expect(response.body.deleted).toEqual({ recommendations: 0, triads: 1, modelSnapshots: 0 });
      expect(response.body.request).toMatchObject({ type: 'reset', status: 'done', profileId: ownerProfileId });

      expect(await triads.count({ where: { profileId: ownerProfileId } })).toBe(0);
      const watched = await request(app.getHttpServer())
        .get(`/profiles/${ownerProfileId}/watched-titles`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(watched.body).toHaveLength(3);
      await request(app.getHttpServer()).get('/consents').set('Authorization', `Bearer ${owner.token}`).expect(200);
      const audited = await audit.findOne({ where: { action: 'privacy.reset', resourceId: ownerProfileId } });
      expect(audited?.status).toBe('ok');

      // A fresh round can start again on the same watch history.
      await completeOneRound(app, owner.token, ownerProfileId);
    });
  });

  describe('delete', () => {
    let requestId: string;

    it('schedules the deletion after the safety period, pauses every profile, and is idempotent', async () => {
      const service = app.get(PrivacyService);
      expect(service.safetyDays).toBeGreaterThan(0);

      const response = await request(app.getHttpServer())
        .post('/privacy/delete')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: PASSWORD })
        .expect(202);
      requestId = response.body.id;
      expect(response.body).toMatchObject({ type: 'delete', status: 'scheduled', userId: owner.userId });
      expect(new Date(response.body.executeAfter).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
      expect(response.body.executionLog.pausedProfileIds).toEqual([ownerProfileId]);

      const profile = await profiles.findOne({ where: { id: ownerProfileId } });
      expect(profile?.pausedAt).not.toBeNull();

      const again = await request(app.getHttpServer())
        .post('/privacy/delete')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: PASSWORD })
        .expect(202);
      expect(again.body.id).toBe(requestId);

      const list = await request(app.getHttpServer()).get('/privacy/requests').set('Authorization', `Bearer ${owner.token}`).expect(200);
      expect(list.body.map((r: { type: string }) => r.type).sort()).toEqual(['delete', 'export', 'reset']);
    });

    it('can be cancelled until it runs, which resumes the profiles', async () => {
      await request(app.getHttpServer())
        .post(`/privacy/delete/${requestId}/cancel`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .expect(404);

      const cancelled = await request(app.getHttpServer())
        .post(`/privacy/delete/${requestId}/cancel`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(cancelled.body).toMatchObject({ id: requestId, status: 'cancelled' });
      const profile = await profiles.findOne({ where: { id: ownerProfileId } });
      expect(profile?.pausedAt).toBeNull();

      const twice = await request(app.getHttpServer())
        .post(`/privacy/delete/${requestId}/cancel`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409);
      expect(twice.body).toMatchObject({ reason: 'not_cancellable', status: 'cancelled' });
    });

    it('pause_all stops recommendations, and resume brings them back (PRIVACY.md §4)', async () => {
      const paused = await request(app.getHttpServer())
        .post('/privacy/pause')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(paused.body.paused).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .get(`/profiles/${ownerProfileId}/recommendations`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200)
        .expect((response) => expect(response.body.state).toBe('paused'));

      const resumed = await request(app.getHttpServer())
        .post('/privacy/resume')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(resumed.body.resumed).toBeGreaterThan(0);
      expect(await profiles.findOne({ where: { id: ownerProfileId } })).toMatchObject({ pausedAt: null });
    });

    it('purges the account when due and leaves only a tombstone and an audit row', async () => {
      const scheduled = await request(app.getHttpServer())
        .post('/privacy/delete')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ password: PASSWORD })
        .expect(202);
      const dueId = scheduled.body.id as string;
      expect(dueId).not.toBe(requestId);

      // Not due yet: the sweep does nothing.
      const service = app.get(PrivacyService);
      expect(await service.runDue()).toBe(0);
      expect(await users.findOne({ where: { id: owner.userId } })).not.toBeNull();

      await requests.update({ id: dueId }, { executeAfter: new Date(Date.now() - 1000) });
      expect(await service.runDue()).toBe(1);

      expect(await users.findOne({ where: { id: owner.userId } })).toBeNull();
      expect(await profiles.findOne({ where: { id: ownerProfileId } })).toBeNull();
      expect(await triads.count({ where: { profileId: ownerProfileId } })).toBe(0);

      const tombstone = await requests.findOne({ where: { id: dueId } });
      expect(tombstone).toMatchObject({ userId: null, status: 'done', type: 'delete', subjectKey: subjectKeyFor(owner.userId) });
      expect(tombstone?.executionLog).toMatchObject({ purged: { profiles: 1, titleStates: 3, triads: 1 } });
      // Every earlier request of the same account is a tombstone too.
      const earlier = await requests.findOne({ where: { id: requestId } });
      expect(earlier?.userId).toBeNull();

      // Consents outlive the account the same way (ADR-80): the record of
      // what was agreed to survives, the person it named does not.
      const survivingConsents = await consents.find({ where: { subjectKey: subjectKeyFor(owner.userId) } });
      expect(survivingConsents.length).toBeGreaterThan(0);
      expect(survivingConsents.every((row) => row.userId === null)).toBe(true);

      const executed = await audit.findOne({ where: { action: 'privacy.delete.executed', resourceId: owner.userId } });
      expect(executed).toMatchObject({ actorUserId: null, actorRole: 'system', status: 'ok' });

      await request(app.getHttpServer()).get('/profiles').set('Authorization', `Bearer ${owner.token}`).expect(401);
      await request(app.getHttpServer()).post('/auth/login').send({ email: owner.email, password: PASSWORD }).expect(401);
    });
  });
});
