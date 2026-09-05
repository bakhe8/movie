import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { PasswordReset } from '../src/entities/password-reset.entity';
import { User } from '../src/entities/user.entity';

const PASSWORD = 'CorrectHorseBattery1';

// An address is one account however it is typed (auth/email.ts, found by the
// live round of 2026-09-05): registered with capitals and a stray space, it
// logs in and asks for a reset in lower case, over real HTTP so the global
// ValidationPipe's transform is what folds it. One register, one login, one
// reset request -- well under the 5/min per-IP throttle on these routes.
describe('Email case-insensitivity at the door', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let resets: Repository<PasswordReset>;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const typed = `  Case.Test-${stamp}@Example.COM `;
  const folded = `case.test-${stamp}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    users = app.get<Repository<User>>(getRepositoryToken(User));
    resets = app.get<Repository<PasswordReset>>(getRepositoryToken(PasswordReset));
  }, 20_000);

  afterAll(async () => {
    const user = await users.findOne({ where: { email: folded } });
    if (user) {
      await resets.delete({ userId: user.id });
      await users.delete({ id: user.id });
    }
    await app.close();
  });

  it('stores the folded address, then logs in and requests a reset under another spelling', async () => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: typed, password: PASSWORD, firstName: 'Case', lastName: 'Test' })
      .expect(201);
    expect(registered.body.user.email).toBe(folded);
    expect(await users.findOne({ where: { email: folded } })).not.toBeNull();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: folded.toUpperCase(), password: PASSWORD })
      .expect(201);

    await request(app.getHttpServer()).post('/auth/password-reset/request').send({ email: `Case.Test-${stamp}@example.com` }).expect(202);
    const user = await users.findOne({ where: { email: folded } });
    expect(await resets.count({ where: { userId: user!.id } })).toBe(1);
  });
});
