import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/modules/app/app.module';
import { EmailChange } from '../src/entities/email-change.entity';
import { MailOutbox } from '../src/entities/mail-outbox.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';
import { User } from '../src/entities/user.entity';
import { AuthService } from '../src/modules/auth/auth.service';
import { hashEmailChangeToken } from '../src/modules/auth/email-change.service';

const PASSWORD = 'CorrectHorseBattery1';

interface Pair {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
}

// Account settings (owner-approved design 2026-09-06): change password and
// change email, over real HTTP and real Postgres. The mail transport is the
// log one under test (nothing is actually sent), so -- same technique as
// password-reset.e2e-spec.ts -- confirm is exercised with a token this test
// mints itself and writes as the row's hash, proving the hash-only storage
// rather than working around it.
describe('Account settings: change password and change email', () => {
  let app: INestApplication;
  let refreshTokens: Repository<RefreshToken>;
  let users: Repository<User>;
  let emailChanges: Repository<EmailChange>;
  let mailOutbox: Repository<MailOutbox>;

  async function register(label: string): Promise<Pair> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const result = await app.get(AuthService).register({ email, password: PASSWORD }, '127.0.0.1');
    return result as unknown as Pair;
  }

  async function liveEmailChangeToken(userId: string): Promise<string> {
    const raw = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const row = await emailChanges.findOne({ where: { userId }, order: { createdAt: 'DESC' } });
    await emailChanges.update({ id: row!.id }, { tokenHash: hashEmailChangeToken(raw) });
    return raw;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    refreshTokens = app.get<Repository<RefreshToken>>(getRepositoryToken(RefreshToken));
    users = app.get<Repository<User>>(getRepositoryToken(User));
    emailChanges = app.get<Repository<EmailChange>>(getRepositoryToken(EmailChange));
    mailOutbox = app.get<Repository<MailOutbox>>(getRepositoryToken(MailOutbox));
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/change-password', () => {
    it('rejects an incorrect current password', async () => {
      const account = await register('cp-wrong');

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ currentPassword: 'not-it-at-all', newPassword: 'brand-new-password-1' })
        .expect(401);

      // The old password still works.
      await request(app.getHttpServer()).post('/auth/login').send({ email: account.user.email, password: PASSWORD }).expect(201);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: 'brand-new-password-1' })
        .expect(401);
    });

    it('changes the password, keeps the presented session alive, and ends every other one', async () => {
      const account = await register('cp-ok');
      const other = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.user.email, password: PASSWORD })
        .expect(201);
      const otherRefresh = other.body.refresh_token as string;

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'brand-new-password-1', refresh_token: account.refresh_token })
        .expect(200);

      // Old password rejected, new one works.
      await request(app.getHttpServer()).post('/auth/login').send({ email: account.user.email, password: PASSWORD }).expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.user.email, password: 'brand-new-password-1' })
        .expect(201);

      // The session that presented itself survives; the other one does not.
      await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: account.refresh_token }).expect(200);
      await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: otherRefresh }).expect(401);
      const revoked = await refreshTokens.findOne({ where: { userId: account.user.id, revokedReason: 'password_changed' } });
      expect(revoked).not.toBeNull();
    });
  });

  describe('POST /auth/email-change/request + /auth/email-change/confirm', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .send({ newEmail: 'someone@example.com', currentPassword: PASSWORD })
        .expect(401);
    });

    it('rejects the wrong password and an address already in use', async () => {
      const account = await register('ec-guard');
      const other = await register('ec-taken');

      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ newEmail: 'fresh@example.com', currentPassword: 'wrong-password' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ newEmail: other.user.email, currentPassword: PASSWORD })
        .expect(409);
    });

    it('queues a mail addressed to the new email only, and confirming it moves the account without ending any session', async () => {
      const account = await register('ec-ok');
      const newEmail = `new-${Date.now()}@example.com`;

      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ newEmail, currentPassword: PASSWORD })
        .expect(202);

      const mail = await mailOutbox.findOne({
        where: { kind: 'email_change', userId: account.user.id },
        order: { createdAt: 'DESC' },
      });
      expect(mail?.toAddress).toBe(newEmail);
      expect(mail?.toAddress).not.toBe(account.user.email);

      const token = await liveEmailChangeToken(account.user.id);
      const confirmed = await request(app.getHttpServer()).post('/auth/email-change/confirm').send({ token }).expect(200);
      expect(confirmed.body).toEqual({ email: newEmail });

      const updated = await users.findOne({ where: { id: account.user.id } });
      expect(updated?.email).toBe(newEmail);

      // Single use; the account's own session is untouched by a change of email.
      await request(app.getHttpServer()).post('/auth/email-change/confirm').send({ token }).expect(400);
      await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: account.refresh_token }).expect(200);
    });

    it('a second request revokes the first link', async () => {
      const account = await register('ec-revoke');

      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ newEmail: `first-${Date.now()}@example.com`, currentPassword: PASSWORD })
        .expect(202);
      const first = await emailChanges.findOne({ where: { userId: account.user.id }, order: { createdAt: 'DESC' } });

      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .set('Authorization', `Bearer ${account.access_token}`)
        .send({ newEmail: `second-${Date.now()}@example.com`, currentPassword: PASSWORD })
        .expect(202);

      const revokedFirst = await emailChanges.findOne({ where: { id: first!.id } });
      expect(revokedFirst?.revokedAt).not.toBeNull();
    });

    it('rejects an expired link', async () => {
      const account = await register('ec-expired');
      const token = `expired-${Date.now()}`;
      await emailChanges.save(
        emailChanges.create({
          userId: account.user.id,
          newEmail: `expired-${Date.now()}@example.com`,
          tokenHash: hashEmailChangeToken(token),
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await request(app.getHttpServer()).post('/auth/email-change/confirm').send({ token }).expect(400);
    });
  });
});
