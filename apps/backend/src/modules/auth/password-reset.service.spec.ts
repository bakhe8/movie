import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { PasswordReset } from '../../entities/password-reset.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { User } from '../../entities/user.entity';
import type { AuditService } from '../audit/audit.service';
import type { Mailer } from '../mail/mailer';
import { PasswordResetService, hashResetToken } from './password-reset.service';

function repoMock() {
  return {
    findOne: vi.fn(),
    create: vi.fn((data: Record<string, unknown>) => ({ id: 'reset-1', ...data })),
    save: vi.fn(async (entity: unknown) => entity),
    update: vi.fn(async () => ({ affected: 1 })),
    delete: vi.fn(async () => ({ affected: 0 })),
  };
}

const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('PasswordResetService', () => {
  let users: ReturnType<typeof repoMock>;
  let resets: ReturnType<typeof repoMock>;
  let refreshTokens: ReturnType<typeof repoMock>;
  let mailer: { send: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: PasswordResetService;

  const activeUser = { id: 'user-1', email: 'someone@example.com', active: true };

  beforeEach(() => {
    users = repoMock();
    resets = repoMock();
    refreshTokens = repoMock();
    mailer = { send: vi.fn(async () => undefined) };
    audit = { record: vi.fn(async () => ({})) };
    service = new PasswordResetService(
      users as unknown as Repository<User>,
      resets as unknown as Repository<PasswordReset>,
      refreshTokens as unknown as Repository<RefreshToken>,
      mailer as unknown as Mailer,
      audit as unknown as AuditService,
      configOf({ FRONTEND_URL: 'https://kolme.app/' }),
    );
  });

  describe('request', () => {
    it('resolves without sending for an unknown address, and audits the attempt', async () => {
      users.findOne.mockResolvedValue(null);

      await expect(service.request('nobody@example.com', '1.2.3.4')).resolves.toBeUndefined();

      expect(mailer.send).not.toHaveBeenCalled();
      expect(resets.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null, status: 'failed', reason: 'no_reset_sent: no account' }),
      );
    });

    it('revokes older live links, stores only a hash, and mails a link carrying the raw token', async () => {
      users.findOne.mockResolvedValue(activeUser);

      await service.request(activeUser.email, null);

      expect(resets.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      const saved = resets.save.mock.calls[0][0] as { tokenHash: string };
      const mail = mailer.send.mock.calls[0][0] as { to: string; text: string };
      const link = mail.text.match(/https?:\/\/\S+/)?.[0] ?? '';
      const raw = new URL(link).searchParams.get('token') ?? '';
      expect(raw).not.toBe('');
      expect(saved.tokenHash).toBe(hashResetToken(raw));
      expect(mail.text).not.toContain(saved.tokenHash);
      expect(mail.to).toBe(activeUser.email);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', status: 'ok' }));
    });

    // H1: a provider failure must be indistinguishable from a success from
    // outside -- a 500 here, next to the 202 an unknown address gets, would
    // be a membership oracle. The undelivered token is revoked and the
    // failure is audited instead.
    it('resolves like a success when the mail provider fails, revoking the undelivered token and auditing the failure', async () => {
      users.findOne.mockResolvedValue(activeUser);
      mailer.send.mockRejectedValue(new Error('SMTP server rejected the message for someone@example.com'));

      await expect(service.request(activeUser.email, '1.2.3.4')).resolves.toBeUndefined();

      expect(resets.update).toHaveBeenLastCalledWith({ id: 'reset-1' }, { revokedAt: expect.any(Date) });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-1', status: 'failed', reason: 'mail_send_failed' }),
      );
    });
  });

  describe('confirm', () => {
    const validReset = () => ({
      id: 'reset-1',
      userId: 'user-1',
      tokenHash: hashResetToken('raw-token'),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null as Date | null,
      revokedAt: null as Date | null,
    });

    it.each([
      ['unknown', null, 'unknown token'],
      ['already used', { ...validReset(), usedAt: new Date() }, 'already used'],
      ['revoked', { ...validReset(), revokedAt: new Date() }, 'revoked'],
      ['expired', { ...validReset(), expiresAt: new Date(Date.now() - 1) }, 'expired'],
    ])('rejects an %s link with the same 400 and audits why', async (_case, reset, reason) => {
      resets.findOne.mockResolvedValue(reset);

      await expect(service.confirm('raw-token', 'new-password', null)).rejects.toBeInstanceOf(BadRequestException);

      expect(users.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', reason }));
    });

    it('sets a hashed password, spends the token, and ends every session', async () => {
      resets.findOne.mockResolvedValue(validReset());
      users.findOne.mockResolvedValue(activeUser);

      await service.confirm('raw-token', 'new-password', null);

      const [, patch] = users.update.mock.calls[0] as [unknown, { password: string }];
      expect(patch.password).not.toBe('new-password');
      expect(patch.password).toMatch(/^\$2[aby]\$/);
      expect(resets.update).toHaveBeenCalledWith({ id: 'reset-1' }, { usedAt: expect.any(Date) });
      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ revokedReason: 'password_reset' }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', status: 'ok' }));
    });
  });
});
