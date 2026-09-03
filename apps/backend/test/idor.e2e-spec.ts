import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { User } from '../src/entities/user.entity';

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

    // H2 (an independent audit's finding): login() already rejects a
    // deactivated account, but that's not what runs on every other guarded
    // request -- JwtStrategy calls AuthService.validateUser(), which never
    // checked `active`. A still-unexpired JWT from before deactivation kept
    // full API access. Deactivate directly via the repository (no admin
    // endpoint exists yet to do it through the API) and prove the same
    // token that worked above now doesn't.
    it("rejects a deactivated account's still-valid JWT", async () => {
      const user = await registerUser('deactivated');
      const usersRepository = app.get<Repository<User>>(getRepositoryToken(User));

      await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      await usersRepository.update({ email: user.email }, { active: false });

      await request(app.getHttpServer())
        .get('/profiles')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(401);
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

  // H4 (an independent audit's finding): none of these routes validated that
  // a path param was even a UUID before handing it to TypeORM/Postgres, so a
  // malformed id (or any id-shaped route colliding with a real one) fell
  // through to a Postgres cast error and came back as an unhandled 500 --
  // cheap noise for error monitoring, and the wrong contract (400 expected).
  describe('malformed ids (H4)', () => {
    it('rejects a malformed profileId with 400, not 500', async () => {
      await request(app.getHttpServer())
        .get('/profiles/not-a-uuid')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(400);
    });

    it('rejects a malformed titleId on the title-lookup route with 400, not 500', async () => {
      // Auth-guarded since M2 -- a real token is required to even reach the
      // ParseUUIDPipe check.
      await request(app.getHttpServer())
        .get('/titles/not-a-uuid')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(400);
    });

    it('rejects a malformed titleId when writing watch state with 400, not 500', async () => {
      await request(app.getHttpServer())
        .patch(`/profiles/${profileAId}/titles/not-a-uuid/state`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ state: 'watched' })
        .expect(400);
    });

    it('rejects a malformed profileId on the recommendations route with 400, not 500', async () => {
      await request(app.getHttpServer())
        .get('/profiles/not-a-uuid/recommendations')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(400);
    });

    // TriadsController was left out of the original H4 fix -- another
    // session was actively editing triads.controller.ts (the replacement
    // feature) at the time; closed now that its work has landed.
    it('rejects a malformed profileId on the current-triad route with 400, not 500', async () => {
      await request(app.getHttpServer())
        .get('/profiles/not-a-uuid/triads/current')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(400);
    });

    it('rejects a malformed profileId on the completed-triads route with 400, not 500', async () => {
      await request(app.getHttpServer())
        .get('/profiles/not-a-uuid/triads')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(400);
    });

    it('rejects a malformed triadId on the rank route with 400, not 500', async () => {
      await request(app.getHttpServer())
        .post('/triads/not-a-uuid/rank')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          ranking: [
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333',
          ],
        })
        .expect(400);
    });

    it('rejects a malformed triadId on the replace route with 400, not 500', async () => {
      await request(app.getHttpServer())
        .post('/triads/not-a-uuid/replace')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ titleId: '11111111-1111-4111-8111-111111111111', reason: 'not_watched' })
        .expect(400);
    });
  });

  // M2 (an independent audit's finding): the catalog -- including the full
  // 13-dimension fingerprint and third-party externalIds, a licensed derived
  // asset (DATA_LICENSING.md) -- was reachable by anyone with no token at
  // all, with only the global 60 req/min throttle in the way.
  describe('catalog auth (M2)', () => {
    it('rejects an unauthenticated list request', async () => {
      await request(app.getHttpServer()).get('/titles').expect(401);
    });

    it('rejects an unauthenticated single-title request', async () => {
      await request(app.getHttpServer())
        .get('/titles/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });

    it('never returns fingerprint or externalIds, even to an authenticated caller', async () => {
      const listResponse = await request(app.getHttpServer())
        .get('/titles?limit=1')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);

      expect(listResponse.body.items.length).toBeGreaterThan(0);
      const [listed] = listResponse.body.items;
      expect(listed).not.toHaveProperty('fingerprint');
      expect(listed).not.toHaveProperty('externalIds');

      const singleResponse = await request(app.getHttpServer())
        .get(`/titles/${listed.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);

      expect(singleResponse.body).not.toHaveProperty('fingerprint');
      expect(singleResponse.body).not.toHaveProperty('externalIds');
    });
  });

  // M3 (an independent audit's finding): register() checked for an existing
  // email with findOne(), then save()'d unconditionally -- two concurrent
  // registrations for the same email could both pass the check before
  // either saved, so the loser hit the raw unique-constraint error as an
  // unhandled 500 instead of the 409 a duplicate email should produce.
  describe('register race (M3)', () => {
    it('maps the losing concurrent registration to 409, not 500', async () => {
      const email = `m3-race-${Date.now()}@example.com`;
      const payload = (lastName: string) => ({
        email,
        password: 'CorrectHorseBattery1',
        firstName: 'Race',
        lastName,
      });

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post('/auth/register').send(payload('First')),
        request(app.getHttpServer()).post('/auth/register').send(payload('Second')),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
    });
  });
});
