import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/modules/app/app.module';

// AuthController overrides the app-wide 60 req/min throttle with a tighter
// 5 req/min limit on /auth/register and /auth/login specifically, to slow
// down credential-stuffing/brute-force attempts (see AUTH_THROTTLE in
// auth.controller.ts). This suite exists because the NestJS 10->11 upgrade
// (ARCHITECTURE_DECISIONS.md ADR-29) moved to a @nestjs/throttler version
// whose peer range was the whole reason v11 was chosen over v12 -- it proves
// the guard still actually enforces the limit, not just that the app boots.
describe('Auth rate limiting', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    // Mirrors main.ts's bootstrap (M10) -- e2e tests build their own Nest
    // app directly and never run that function, so this has to be set here
    // too for the forwarded-header test below to exercise the real config.
    app.set('trust proxy', 1);
    await app.init();
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('blocks the 6th /auth/login attempt within the same minute (429)', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });

    const responses = [];
    for (let i = 0; i < 6; i += 1) {
      responses.push(await attempt());
    }

    const statuses = responses.map((response) => response.status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  // M10 (an independent audit's finding): without `trust proxy` configured,
  // Express's req.ip behind any reverse proxy is the proxy's own address for
  // every request, so every real client shared one throttler bucket -- the
  // 5/min brute-force limit above would have been 5/min combined for
  // everyone, not 5/min each. With `trust proxy` set (beforeAll), the
  // default @nestjs/throttler tracker (which just reads req.ip) now buckets
  // by the address in X-Forwarded-For instead.
  it('tracks the throttle bucket per forwarded client IP, not the proxy hop', async () => {
    const attempt = (forwardedFor: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', forwardedFor)
        .send({ email: 'nobody@example.com', password: 'wrong-password' });

    const firstClientResponses = [];
    for (let i = 0; i < 6; i += 1) {
      firstClientResponses.push(await attempt('203.0.113.10'));
    }
    const firstClientStatuses = firstClientResponses.map((response) => response.status);
    expect(firstClientStatuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(firstClientStatuses[5]).toBe(429);

    // A second forwarded address arrives fresh, not pre-exhausted by the
    // first client's five attempts -- proves the two are separate buckets.
    const secondClientResponse = await attempt('203.0.113.20');
    expect(secondClientResponse.status).toBe(401);
  });
});
