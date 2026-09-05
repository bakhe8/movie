import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { PasswordReset } from '../../entities/password-reset.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { User } from '../../entities/user.entity';
import type { AuditService } from '../audit/audit.service';
import type { MailOutboxService } from '../mail/mail-outbox.service';
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
  let outbox: { enqueue: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: PasswordResetService;

  const activeUser = { id: 'user-1', email: 'someone@example.com', active: true };

  beforeEach(() => {
    users = repoMock();
    resets = repoMock();
    refreshTokens = repoMock();
    outbox = { enqueue: vi.fn(async () => ({ id: 'mail-1', status: 'delivered' })) };
    audit = { record: vi.fn(async () => ({})) };
    service = new PasswordResetService(
      users as unknown as Repository<User>,
      resets as unknown as Repository<PasswordReset>,
      refreshTokens as unknown as Repository<RefreshToken>,
      outbox as unknown as MailOutboxService,
      audit as unknown as AuditService,
      configOf({ FRONTEND_URL: 'https://kolme.app/' }),
    );
  });

  describe('request', () => {
    it('resolves without sending for an unknown address, and audits the attempt', async () => {
      users.findOne.mockResolvedValue(null);

      await expect(service.request('nobody@example.com', '1.2.3.4')).resolves.toBeUndefined();

      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(resets.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: null, status: 'failed', reason: 'no_reset_sent: no account' }),
      );
    });

    it('revokes older live links, stores only a hash, and queues a link carrying the raw token that expires with the row', async () => {
      users.findOne.mockResolvedValue(activeUser);

      await service.request(activeUser.email, null);

      expect(resets.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      const saved = resets.save.mock.calls[0][0] as { tokenHash: string; expiresAt: Date };
      const mail = outbox.enqueue.mock.calls[0][0] as { userId: string; kind: string; to: string; text: string; expiresAt: Date };
      const link = mail.text.match(/https?:\/\/\S+/)?.[0] ?? '';
      const raw = new URL(link).searchParams.get('token') ?? '';
      expect(raw).not.toBe('');
      expect(saved.tokenHash).toBe(hashResetToken(raw));
      expect(mail.text).not.toContain(saved.tokenHash);
      expect(mail.to).toBe(activeUser.email);
      expect(mail).toMatchObject({ userId: 'user-1', kind: 'password_reset', expiresAt: saved.expiresAt });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', status: 'ok' }));
    });

    // ADR-97: a provider failure leaves the row pending for the sweep to
    // retry; the token stays live (the link may still arrive) and the audit
    // says so.
    it('resolves like a success when the first send fails, keeping the token for the retry and auditing the queueing', async () => {
      users.findOne.mockResolvedValue(activeUser);
      outbox.enqueue.mockResolvedValue({ id: 'mail-1', status: 'pending' });

      await expect(service.request(activeUser.email, '1.2.3.4')).resolves.toBeUndefined();

      expect(resets.update).not.toHaveBeenCalledWith({ id: 'reset-1' }, expect.anything());
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'user-1', status: 'scheduled', reason: 'mail_queued_for_retry' }),
      );
    });

    // H1: a failure must be indistinguishable from a success from outside --
    // a 500 here, next to the 202 an unknown address gets, would be a
    // membership oracle. A row dead on arrival (nobody will ever receive
    // it) or a queue that cannot be written revokes the token and audits.
    it.each([
      ['the row is dead on its first attempt', () => outbox.enqueue.mockResolvedValue({ id: 'mail-1', status: 'dead' })],
      ['the outbox cannot be written', () => outbox.enqueue.mockRejectedValue(new Error('connection refused'))],
    ])('resolves like a success when %s, revoking the undelivered token and auditing the failure', async (_case, arrange) => {
      users.findOne.mockResolvedValue(activeUser);
      arrange();

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
