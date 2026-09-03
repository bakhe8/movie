import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
});
