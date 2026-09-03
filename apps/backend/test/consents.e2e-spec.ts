import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

const CONSENT_VERSION = 'privacy-2.0';

async function registerUser(app: INestApplication, label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'CorrectHorseBattery1', firstName: 'Consent', lastName: label })
    .expect(201);
  return response.body.access_token as string;
}

// Blueprint gap 7 (onboarding records no consent): GET/PUT /consents, real
// HTTP against real Postgres, matching API.md §2.2's contract kept under the
// unversioned /api prefix (ADR-15 -- not the full /api/v1 migration).
describe('Consents (real HTTP, real DB, blueprint gap 7)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/consents').expect(401);
    await request(app.getHttpServer())
      .put('/consents')
      .send({ consents: [{ purpose: 'watch_history', version: CONSENT_VERSION, granted: true }] })
      .expect(401);
  });

  it('rejects a purpose outside the live closed list (reserved-for-later purposes are not accepted yet)', async () => {
    const token = await registerUser(app, 'reserved-purpose');

    await request(app.getHttpServer())
      .put('/consents')
      .set('Authorization', `Bearer ${token}`)
      .send({ consents: [{ purpose: 'email_recommendations', version: CONSENT_VERSION, granted: true }] })
      .expect(400);
  });

  it('records grants, lists only the caller\'s own rows, and flips granted/revokedAt on a later decline', async () => {
    const tokenA = await registerUser(app, 'consent-a');
    const tokenB = await registerUser(app, 'consent-b');

    const granted = await request(app.getHttpServer())
      .put('/consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        consents: [
          { purpose: 'watch_history', version: CONSENT_VERSION, granted: true },
          { purpose: 'personalization_individual', version: CONSENT_VERSION, granted: true },
        ],
      })
      .expect(200);
    expect(granted.body).toHaveLength(2);
    expect(granted.body.every((row: { granted: boolean }) => row.granted)).toBe(true);
    expect(granted.body.every((row: { revokedAt: string | null }) => row.revokedAt === null)).toBe(true);

    const listed = await request(app.getHttpServer())
      .get('/consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(listed.body).toHaveLength(2);

    // User B never granted anything -- their own list is empty, not A's.
    const listedB = await request(app.getHttpServer())
      .get('/consents')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(listedB.body).toEqual([]);

    // Re-submitting the same (purpose, version) with granted: false flips
    // the existing row rather than creating a second one for that version.
    const declined = await request(app.getHttpServer())
      .put('/consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ consents: [{ purpose: 'personalization_individual', version: CONSENT_VERSION, granted: false }] })
      .expect(200);
    expect(declined.body[0].granted).toBe(false);
    expect(declined.body[0].revokedAt).not.toBeNull();

    const afterDecline = await request(app.getHttpServer())
      .get('/consents')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(afterDecline.body).toHaveLength(2);
    const watchHistoryRow = afterDecline.body.find((row: { purpose: string }) => row.purpose === 'watch_history');
    expect(watchHistoryRow.granted).toBe(true);
    const personalizationRow = afterDecline.body.find(
      (row: { purpose: string }) => row.purpose === 'personalization_individual',
    );
    expect(personalizationRow.granted).toBe(false);
  });
});
