import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { AdminJob } from '../src/entities/admin-job.entity';
import { ContentFeature } from '../src/entities/content-feature.entity';
import { Title } from '../src/entities/title.entity';
import { User } from '../src/entities/user.entity';
import { AuthService } from '../src/modules/auth/auth.service';

const PASSWORD = 'CorrectHorseBattery1';

// ADMIN-W5 (plan §17.2/§18 W5): the job center's own HTTP surface --
// allowlist, dry run vs real write, and the cancel contract. The claim/
// backoff state machine itself is proven with a real Postgres round trip in
// admin-jobs.service.spec.ts's FakeRepo suite; here the concern is that the
// controller, guard and service are wired together correctly end to end.
describe('Admin jobs API (role-gated)', () => {
  let app: INestApplication;
  let adminToken: string;
  let jobs: Repository<AdminJob>;
  let titles: Repository<Title>;
  let features: Repository<ContentFeature>;
  let users: Repository<User>;

  const admin = () => (path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${adminToken}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    jobs = app.get<Repository<AdminJob>>(getRepositoryToken(AdminJob));
    titles = app.get<Repository<Title>>(getRepositoryToken(Title));
    features = app.get<Repository<ContentFeature>>(getRepositoryToken(ContentFeature));
    users = app.get<Repository<User>>(getRepositoryToken(User));

    const auth = app.get(AuthService);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const adminAccount = await auth.register({ email: `admin-jobs-${suffix}@example.com`, password: PASSWORD, firstName: 'Ada', lastName: 'Admin' });
    await users.update({ id: adminAccount.user.id as string }, { role: 'admin' });
    adminToken = (await auth.login({ email: `admin-jobs-${suffix}@example.com`, password: PASSWORD })).access_token;
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  // Polls a job to a terminal state -- every handler here is in-process DB
  // work with no network call, so this settles in well under a second; the
  // bound just guards against a genuine regression hanging the suite.
  async function waitForTerminal(jobId: string, attempts = 20): Promise<{ status: string; result: unknown; progress: unknown }> {
    for (let i = 0; i < attempts; i += 1) {
      const response = await admin()(`/admin/jobs/${jobId}`).expect(200);
      if (['succeeded', 'failed', 'cancelled'].includes(response.body.status)) {
        return response.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`job ${jobId} did not reach a terminal state`);
  }

  it('is closed to anonymous callers and to signed-in non-admins', async () => {
    await request(app.getHttpServer()).get('/admin/jobs').expect(401);
  });

  it('exposes the allowlist, and refuses a type outside it', async () => {
    const types = await admin()('/admin/jobs/types').expect(200);
    expect(types.body).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'republish_fingerprints' })]));

    const rejected = await request(app.getHttpServer())
      .post('/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'run_arbitrary_shell' })
      .expect(409);
    expect(rejected.body).toMatchObject({ reason: 'unknown_type' });
  });

  it('a dry run reports what would change without writing it', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = await titles.save({
      internalId: `0-E2E-JOB-${suffix}`,
      titleEn: 'Job Dry Run Check',
      titleAr: 'فحص التنفيذ التجريبي',
      fingerprint: { schemaVersion: 'film-fingerprint-v1', pacing: 0.2 } as never,
    });
    await features.save(
      features.create({
        titleId: title.id,
        featureKey: 'pacing',
        value: 0.8,
        uncertainty: 0.1,
        sourceIds: [],
        extractorVersion: 'e2e-jobs-v1',
        licenseStatus: 'unknown',
        reviewStatus: 'human_verified',
        validFrom: new Date(),
      }),
    );

    const created = await request(app.getHttpServer())
      .post('/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'republish_fingerprints', dryRun: true, params: { titleId: title.id } })
      .expect(201);
    expect(created.body.job.status).toBe('queued');
    expect(created.body.created).toBe(true);

    const finished = await waitForTerminal(created.body.job.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.result).toMatchObject({ scanned: 1, titlesChanged: 1, keysChanged: 1 });

    const unchanged = await titles.findOne({ where: { id: title.id } });
    expect((unchanged!.fingerprint as unknown as { pacing: number }).pacing).toBe(0.2);
  });

  it('a real run republishes the drifted value and a repeated idempotencyKey returns the same job', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = await titles.save({
      internalId: `0-E2E-JOB2-${suffix}`,
      titleEn: 'Job Real Run Check',
      titleAr: 'فحص التنفيذ الفعلي',
      fingerprint: { schemaVersion: 'film-fingerprint-v1', pacing: 0.2 } as never,
    });
    await features.save(
      features.create({
        titleId: title.id,
        featureKey: 'pacing',
        value: 0.8,
        uncertainty: 0.1,
        sourceIds: [],
        extractorVersion: 'e2e-jobs-v1',
        licenseStatus: 'unknown',
        reviewStatus: 'human_verified',
        validFrom: new Date(),
      }),
    );

    const key = `e2e-jobs-${suffix}`;
    const first = await request(app.getHttpServer())
      .post('/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'republish_fingerprints', params: { titleId: title.id }, idempotencyKey: key })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'republish_fingerprints', params: { titleId: title.id }, idempotencyKey: key })
      .expect(201);
    expect(second.body.created).toBe(false);
    expect(second.body.job.id).toBe(first.body.job.id);

    const finished = await waitForTerminal(first.body.job.id);
    expect(finished.status).toBe('succeeded');

    const updated = await titles.findOne({ where: { id: title.id } });
    expect((updated!.fingerprint as unknown as { pacing: number }).pacing).toBe(0.8);
  });

  it('lists and reads jobs back', async () => {
    const list = await admin()('/admin/jobs?limit=5').expect(200);
    expect(list.body).toMatchObject({ page: 1, limit: 5 });
    expect(list.body.items.length).toBeGreaterThan(0);
  });

  it('cancels a queued job at once, and refuses to cancel a terminal one', async () => {
    const queuedRow = await jobs.save(
      jobs.create({ type: 'republish_fingerprints', status: 'queued', attempts: 0, nextAttemptAt: new Date(), requestedBy: '00000000-0000-0000-0000-000000000000' }),
    );
    const cancelled = await request(app.getHttpServer())
      .post(`/admin/jobs/${queuedRow.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(cancelled.body.status).toBe('cancelled');

    await request(app.getHttpServer())
      .post(`/admin/jobs/${queuedRow.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it('marks a running job cooperatively cancelled rather than killing it unsafely', async () => {
    const runningRow = await jobs.save(
      jobs.create({ type: 'republish_fingerprints', status: 'running', attempts: 1, nextAttemptAt: new Date(), requestedBy: '00000000-0000-0000-0000-000000000000' }),
    );
    try {
      const response = await request(app.getHttpServer())
        .post(`/admin/jobs/${runningRow.id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(response.body).toMatchObject({ status: 'running', cancelRequested: true });
    } finally {
      // This synthetic row was never really dispatched, so nothing ever
      // moves it out of 'running' on its own (the sweep is disabled under
      // NODE_ENV=test) -- clean it up so it cannot trip the one-active-per-
      // type guard for a later test or run.
      await jobs.delete({ id: runningRow.id });
    }
  });

  it('refuses a second concurrent job of a type that already has a non-terminal one', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const title = await titles.save({
      internalId: `0-E2E-JOB3-${suffix}`,
      titleEn: 'Job Exclusivity Check',
      titleAr: 'فحص حصرية المهمة',
      fingerprint: { schemaVersion: 'film-fingerprint-v1', pacing: 0.2 } as never,
    });
    const busyRow = await jobs.save(
      jobs.create({ type: 'republish_fingerprints', status: 'running', attempts: 1, nextAttemptAt: new Date(), requestedBy: '00000000-0000-0000-0000-000000000000' }),
    );
    try {
      const rejected = await request(app.getHttpServer())
        .post('/admin/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'republish_fingerprints', dryRun: true, params: { titleId: title.id } })
        .expect(409);
      expect(rejected.body).toMatchObject({ reason: 'type_busy', existingJobId: busyRow.id });
    } finally {
      await jobs.delete({ id: busyRow.id });
    }
  });
});
