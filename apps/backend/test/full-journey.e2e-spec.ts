import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { Title } from '../src/entities/title.entity';

// ALPHA_PLAN 1.4: the whole first-run journey with the *real* Python model
// service, not the stand-in training.e2e-spec.ts uses -- register, watch,
// three rounds, and recommendations appear with no CLI in the loop
// (BP §18.1's first line).
//
// The interpreter is resolved in this order: $MODEL_SERVICE_PYTHON (an
// explicit path to an interpreter with services/workers' dependencies), then
// `poetry run python` when poetry is on PATH. With neither, the whole file
// skips rather than failing -- CI's backend job is Node-only today, and a
// poetry install is not on every developer's PATH.
const EXPLICIT_PYTHON = process.env.MODEL_SERVICE_PYTHON;
const HAS_POETRY = !EXPLICIT_PYTHON && spawnSync('poetry', ['--version'], { shell: true }).status === 0;
const PYTHON_RUNNABLE = Boolean(EXPLICIT_PYTHON) || HAS_POETRY;
const [SPAWN_COMMAND, SPAWN_ARGS] = EXPLICIT_PYTHON
  ? [EXPLICIT_PYTHON, ['-m', 'src.model_service']]
  : ['poetry', ['run', 'python', '-m', 'src.model_service']];

const WORKERS_DIR = resolve(__dirname, '../../../services/workers');
const SERVICE_PORT = 8098; // not 8001: that is a session's own long-running service
const SERVICE_URL = `http://127.0.0.1:${SERVICE_PORT}`;
const SERVICE_TOKEN = 'e2e-full-journey-token';
const TEST_DATABASE_URL = 'postgresql://movieapp:test_password@127.0.0.1:5544/moviedb_test';

const V1 = [
  'pacing', 'rhythmVariance', 'ambiguity', 'psychologicalDepth', 'warmth', 'darkness', 'linearity',
  'dialogueDensity', 'actionIntensity', 'plotComplexity', 'visualComplexity', 'soundscapeComplexity', 'colorSaturation',
] as const;
const V2 = [
  'narrative.revelation', 'narrative.perspective', 'narrative.unreliability', 'tone.irony', 'tone.unease',
  'tone.catharsis', 'tone.compassion', 'characters.agency', 'characters.moralAmbiguity', 'characters.transformation',
  'characters.relationshipCentrality', 'ending.openness', 'ending.twist', 'ending.justice', 'ending.optimism',
] as const;
const V3 = [
  'rhythm.setupLength', 'rhythm.turningPointDensity', 'rhythm.deliberateness', 'information.expositionDirectness',
  'information.subtext', 'information.knowledgeComplexity', 'style.stylization', 'style.experimentation',
  'style.scale', 'tone.playfulness', 'tone.sentimentality', 'narrative.scope',
] as const;

// Every served key present: the real trainer drops any triad whose titles are
// incompletely described (ADR-19), so a partial fingerprint here would make
// the run fail as "invalid" rather than train.
function fullFingerprint(warmth: number) {
  const flat = Object.fromEntries(V1.map((dim) => [dim, dim === 'warmth' ? warmth : 0.5]));
  return {
    schemaVersion: 'film-fingerprint-v1' as const,
    ...flat,
    themes: [],
    confidence: {},
    v2: { schemaVersion: 'film-fingerprint-v2' as const, features: Object.fromEntries(V2.map((d) => [d, 0.5])), themes: [], confidence: {} },
    v3: { schemaVersion: 'film-fingerprint-v3' as const, features: Object.fromEntries(V3.map((d) => [d, 0.5])), confidence: {} },
  };
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVICE_URL}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

describe.skipIf(!PYTHON_RUNNABLE)('First-run journey with the real model service (ALPHA_PLAN 1.4)', () => {
  let app: INestApplication;
  let service: ChildProcess;
  let token: string;
  let profileId: string;

  beforeAll(async () => {
    service = spawn(SPAWN_COMMAND, SPAWN_ARGS, {
      cwd: WORKERS_DIR,
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        MODEL_SERVICE_PORT: String(SERVICE_PORT),
        MODEL_SERVICE_TOKEN: SERVICE_TOKEN,
      },
    });
    if (!(await waitForHealth(60_000))) {
      throw new Error('the real model service did not become healthy');
    }

    process.env.MODEL_SERVICE_URL = SERVICE_URL;
    process.env.MODEL_SERVICE_TOKEN = SERVICE_TOKEN;
    process.env.TRAINING_FIRST_TRIAD_COUNT = '3';
    process.env.TRAINING_EVERY_N_TRIADS = '5';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Six watched titles make three rounds possible (a triad excludes only
    // the previous one, ADR-34); a seventh, unwatched, is what the model can
    // actually recommend at the end.
    const titlesRepository = app.get<Repository<Title>>(getRepositoryToken(Title));
    const suffix = Date.now();
    const titles = await titlesRepository.save(
      Array.from({ length: 7 }, (_, index) => ({
        internalId: `E2E-JOURNEY-${suffix}-${index}`,
        titleEn: `Journey ${index}`,
        titleAr: `رحلة ${index}`,
        fingerprint: fullFingerprint(index / 10) as never,
      })),
    );

    const email = `journey-${suffix}-${Math.random().toString(36).slice(2)}@example.com`;
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery1', firstName: 'Jour', lastName: 'Ney' })
      .expect(201);
    token = registered.body.access_token as string;
    const profile = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Journey ${suffix}` })
      .expect(201);
    profileId = profile.body.id as string;

    for (const title of titles.slice(0, 6)) {
      await request(app.getHttpServer())
        .patch(`/profiles/${profileId}/titles/${title.id}/state`)
        .set('Authorization', `Bearer ${token}`)
        .send({ state: 'watched' })
        .expect(200);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    service?.kill();
    delete process.env.MODEL_SERVICE_URL;
    delete process.env.MODEL_SERVICE_TOKEN;
  });

  it('trains and then recommends with no manual command anywhere in the loop', async () => {
    for (let round = 0; round < 3; round += 1) {
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

    // The third round triggers training by itself; poll the status route the
    // frontend polls, never a CLI.
    const deadline = Date.now() + 60_000;
    let status: { state: string; latestSnapshot: { modelVersion: string } | null } | undefined;
    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer())
        .get(`/profiles/${profileId}/training`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      status = response.body;
      if (status?.state === 'succeeded' || status?.latestSnapshot) {
        break;
      }
      if (status?.state === 'failed') {
        throw new Error(`training failed: ${JSON.stringify(response.body.job)}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(status?.latestSnapshot).toMatchObject({ modelVersion: expect.any(String) });

    const recommendations = await request(app.getHttpServer())
      .get(`/profiles/${profileId}/recommendations`)
      .set('Authorization', `Bearer ${token}`)
      .query({ limit: 5 })
      .expect(200);
    // Which titles rank top depends on everything else in the shared
    // postgres-test catalog; what this asserts is the journey's own claim --
    // results exist, and they are served by the model this run just trained.
    expect(recommendations.body.length).toBeGreaterThan(0);
    expect(recommendations.body[0].modelVersion).toBe(status?.latestSnapshot?.modelVersion);
  }, 120_000);
});
