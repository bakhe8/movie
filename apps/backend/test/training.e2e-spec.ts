import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';

// A stand-in for services/workers/src/model_service.py that records every
// request and answers with the same job shape. The Python service has its
// own tests (tests/test_model_service.py); this file proves the backend
// side of ADR-25 over real HTTP and real Postgres: the third completed
// triad -- and only the third -- makes the backend ask for training,
// without any CLI in the loop (BP §18.1, first line).
interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

function startFakeModelService(): Promise<{ server: Server; url: string; received: RecordedRequest[] }> {
  const received: RecordedRequest[] = [];
  const jobs = new Map<string, { id: string; profileId: string; status: string }>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, body });
      const url = new URL(req.url ?? '/', 'http://fake');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url.pathname === '/train') {
        const { profileId } = JSON.parse(body) as { profileId: string };
        const existing = jobs.get(profileId);
        if (existing && existing.status === 'queued') {
          res.statusCode = 200;
          res.end(JSON.stringify(job(existing)));
          return;
        }
        const created = { id: randomUUID(), profileId, status: 'queued' };
        jobs.set(profileId, created);
        res.statusCode = 202;
        res.end(JSON.stringify(job(created)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/train') {
        const found = jobs.get(url.searchParams.get('profileId') ?? '');
        res.statusCode = 200;
        res.end(JSON.stringify({ job: found ? job(found) : null }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, received });
    });
  });
}

function job(base: { id: string; profileId: string; status: string }) {
  return {
    ...base,
    requestedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    errorKind: null,
    error: null,
    result: null,
  };
}

// The training request is fired by a TypeORM subscriber after the ranking
// response is already on its way back, so the test has to wait for it. The
// budget is generous because a loaded CI runner is the case that matters:
// at 3s this timed out on GitHub Actions (both the run and its retry) while
// passing locally every time, and because the helper used to return quietly
// on timeout, the failure surfaced as "expected [] to have length 1" with no
// hint that it was a timeout at all. It now says so.
async function waitFor(predicate: () => boolean, what = 'condition', timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Train', lastName: label })
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
}

describe('Training trigger and status (ADR-25, real HTTP, real DB, fake model service)', () => {
  let app: INestApplication;
  let fake: Awaited<ReturnType<typeof startFakeModelService>>;
  let titleIds: string[];
  let ownerToken: string;
  let ownerProfileId: string;
  let attackerToken: string;

  beforeAll(async () => {
    fake = await startFakeModelService();
    // Read by ModelServiceClient at construction, i.e. during app.init()
    // below; ConfigModule resolves process.env at that moment.
    process.env.MODEL_SERVICE_URL = fake.url;
    process.env.MODEL_SERVICE_TOKEN = 'e2e-shared-token';
    process.env.TRAINING_FIRST_TRIAD_COUNT = '3';
    process.env.TRAINING_EVERY_N_TRIADS = '5';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Six watched titles: a triad excludes only the previous triad's three
    // (ADR-34), so 6 is the smallest pool that yields three rounds in a row.
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save(
      Array.from({ length: 6 }, (_, index) => ({
        internalId: `E2E-TRAIN-${suffix}-${index}`,
        titleEn: `Training Check ${index}`,
        titleAr: `فحص التدريب ${index}`,
      })),
    );
    titleIds = titles.map((title) => title.id);

    ownerToken = await registerUser(app, 'owner');
    ownerProfileId = await createProfile(app, ownerToken, 'Train owner');
    for (const titleId of titleIds) {
      await request(app.getHttpServer())
        .patch(`/profiles/${ownerProfileId}/titles/${titleId}/state`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ state: 'watched' })
        .expect(200);
    }
    attackerToken = await registerUser(app, 'attacker');
  }, 20_000);

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
    delete process.env.MODEL_SERVICE_URL;
    delete process.env.MODEL_SERVICE_TOKEN;
  });

  const trainRequests = () => fake.received.filter((r) => r.method === 'POST' && r.url === '/train');

  it('reports idle with the first threshold before any round is ranked', async () => {
    const response = await request(app.getHttpServer())
      .get(`/profiles/${ownerProfileId}/training`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(response.body).toMatchObject({ state: 'idle', completedTriads: 0, nextTrainingAt: 3, latestSnapshot: null });
  });

  it('refuses an explicit request before any round is ranked, with a reason', async () => {
    const response = await request(app.getHttpServer())
      .post(`/profiles/${ownerProfileId}/train`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    expect(response.body).toMatchObject({ reason: 'need_more_triads', needed: 1 });
    expect(trainRequests()).toHaveLength(0);
  });

  it('asks the model service for training on the third completed round, not before', async () => {
    await completeOneRound(app, ownerToken, ownerProfileId);
    await completeOneRound(app, ownerToken, ownerProfileId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(trainRequests()).toHaveLength(0);

    await completeOneRound(app, ownerToken, ownerProfileId);
    await waitFor(() => trainRequests().length >= 1, 'the third round to trigger a training request');
    const [first] = trainRequests();
    expect(trainRequests()).toHaveLength(1);
    expect(JSON.parse(first.body)).toEqual({ profileId: ownerProfileId });
    expect(first.authorization).toBe('Bearer e2e-shared-token');

    const status = await request(app.getHttpServer())
      .get(`/profiles/${ownerProfileId}/training`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(status.body).toMatchObject({ state: 'queued', completedTriads: 3, nextTrainingAt: 8 });
    expect(status.body.job).toMatchObject({ profileId: ownerProfileId, status: 'queued' });
  });

  it('accepts an explicit request from the owner and is idempotent while a job is queued', async () => {
    const response = await request(app.getHttpServer())
      .post(`/profiles/${ownerProfileId}/train`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(202);
    expect(response.body).toMatchObject({ status: 'queued', created: false });
    expect(response.body.jobId).toEqual(expect.any(String));
  });

  it('hides the profile from anyone else (404, never 403)', async () => {
    await request(app.getHttpServer())
      .post(`/profiles/${ownerProfileId}/train`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/profiles/${ownerProfileId}/training`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .expect(404);
    await request(app.getHttpServer()).get(`/profiles/${ownerProfileId}/training`).expect(401);
  });
});
