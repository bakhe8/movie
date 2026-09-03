import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

// Exercises the app over real HTTP against a real (disposable) Postgres
// instance -- see package.json's `test:e2e*` scripts and
// docker/docker-compose.yml's `postgres-test` service. This is the suite
// that actually proves the assertProfileOwnership() pattern used across
// profiles/triads/recommendations/user-title-state blocks cross-user access,
// not just that the guard function returns the right thing in isolation.
describe('Cross-user access (IDOR) and auth guards', () => {
  let app: INestApplication;
  const unique = Date.now();

  async function registerUser(label: string) {
    const email = `${label}-${unique}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery1', firstName: 'Test', lastName: label })
      .expect(201);
    return { token: response.body.access_token as string, email };
  }

  async function createProfile(token: string, name: string) {
    const response = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return response.body.id as string;
  }

  let userA: { token: string; email: string };
  let userB: { token: string; email: string };
  let profileAId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    userA = await registerUser('user-a');
    userB = await registerUser('user-b');
    profileAId = await createProfile(userA.token, `A's taste profile`);
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  describe('auth guard', () => {
    it('rejects a protected route with no token', async () => {
      await request(app.getHttpServer()).get('/profiles').expect(401);
    });

    it('rejects a protected route with a garbage token', async () => {
      await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('allows the owner through with a valid token', async () => {
      await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
    });
  });

  describe('profiles', () => {
    it("blocks user B from reading user A's profile", async () => {
      await request(app.getHttpServer())
        .get(`/profiles/${profileAId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
    });

    it("blocks user B from renaming user A's profile", async () => {
      await request(app.getHttpServer())
        .patch(`/profiles/${profileAId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it("blocks user B from deleting user A's profile", async () => {
      await request(app.getHttpServer())
        .delete(`/profiles/${profileAId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
    });

    it("does not leak user A's profile into user B's own list", async () => {
      const response = await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(200);

      expect(response.body.find((p: { id: string }) => p.id === profileAId)).toBeUndefined();
    });
  });

  describe('triads', () => {
    it("blocks user B from reading user A's current triad", async () => {
      await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/triads/current`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
    });

    it("blocks user B from reading user A's completed triads", async () => {
      await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/triads`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
    });
  });

  describe('recommendations', () => {
    it("blocks user B from reading user A's recommendations", async () => {
      await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/recommendations`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
    });
  });

  describe('user title state', () => {
    it("blocks user B from writing watch state onto user A's profile", async () => {
      // Any UUID-shaped titleId works here: profile ownership is checked
      // before the title lookup, so this 404s on the profile check itself.
      await request(app.getHttpServer())
        .patch(`/profiles/${profileAId}/titles/00000000-0000-0000-0000-000000000000/state`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ state: 'watched' })
        .expect(404);
    });

    it("blocks user B from reading user A's watchlist", async () => {
      await request(app.getHttpServer())
        .get(`/profiles/${profileAId}/watchlist`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(404);
    });
  });
});
