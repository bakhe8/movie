import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { EmailChange } from '../../entities/email-change.entity';
import { User } from '../../entities/user.entity';
import type { AuditService } from '../audit/audit.service';
import type { MailOutboxService } from '../mail/mail-outbox.service';
import { EmailChangeService, hashEmailChangeToken } from './email-change.service';

vi.mock('bcryptjs', () => ({
  compare: vi.fn(),
}));

function repoMock() {
  return {
    findOne: vi.fn(),
    create: vi.fn((data: Record<string, unknown>) => ({ id: 'change-1', ...data })),
    save: vi.fn(async (entity: unknown) => entity),
    update: vi.fn(async () => ({ affected: 1 })),
  };
}

const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('EmailChangeService', () => {
  let users: ReturnType<typeof repoMock>;
  let changes: ReturnType<typeof repoMock>;
  let outbox: { enqueue: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };
  let service: EmailChangeService;

  const activeUser = { id: 'user-1', email: 'current@example.com', password: 'hashed', active: true };

  beforeEach(() => {
    users = repoMock();
    changes = repoMock();
    outbox = { enqueue: vi.fn(async () => ({ id: 'mail-1', status: 'delivered' })) };
    audit = { record: vi.fn(async () => ({})) };
    vi.mocked(bcrypt.compare).mockReset();
    service = new EmailChangeService(
      users as unknown as Repository<User>,
      changes as unknown as Repository<EmailChange>,
      outbox as unknown as MailOutboxService,
      audit as unknown as AuditService,
      configOf({ FRONTEND_URL: 'https://kolme.app/' }),
    );
  });

  describe('request', () => {
    it('rejects an incorrect password without touching anything', async () => {
      users.findOne.mockResolvedValue(activeUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(service.request('user-1', 'new@example.com', 'wrong', null)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(changes.save).not.toHaveBeenCalled();
    });

    it('rejects a new address identical to the current one', async () => {
      users.findOne.mockResolvedValue(activeUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(service.request('user-1', activeUser.email, 'correct', null)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects an address already registered to another account', async () => {
      users.findOne.mockResolvedValueOnce(activeUser).mockResolvedValueOnce({ id: 'other-user' });
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(service.request('user-1', 'taken@example.com', 'correct', null)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(changes.save).not.toHaveBeenCalled();
    });

    it('revokes older live links, stores only a hash, and mails the new address (never the current one)', async () => {
      users.findOne.mockResolvedValueOnce(activeUser).mockResolvedValueOnce(null);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await service.request('user-1', 'new@example.com', 'correct', null);

      expect(changes.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      const saved = changes.save.mock.calls[0][0] as { tokenHash: string; newEmail: string };
      const mail = outbox.enqueue.mock.calls[0][0] as { to: string; kind: string; text: string };
      expect(mail.to).toBe('new@example.com');
      expect(mail.to).not.toBe(activeUser.email);
      expect(mail.kind).toBe('email_change');
      const link = mail.text.match(/https?:\/\/\S+/)?.[0] ?? '';
      const raw = new URL(link).searchParams.get('token') ?? '';
      expect(saved.tokenHash).toBe(hashEmailChangeToken(raw));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', status: 'ok' }));
    });

    it('raises when the mail cannot be queued, revoking the dead token', async () => {
      users.findOne.mockResolvedValueOnce(activeUser).mockResolvedValueOnce(null);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      outbox.enqueue.mockRejectedValue(new Error('provider down'));

      await expect(service.request('user-1', 'new@example.com', 'correct', null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(changes.update).toHaveBeenLastCalledWith({ id: 'change-1' }, { revokedAt: expect.any(Date) });
    });
  });

  describe('confirm', () => {
    const validChange = () => ({
      id: 'change-1',
      userId: 'user-1',
      newEmail: 'new@example.com',
      tokenHash: hashEmailChangeToken('raw-token'),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null as Date | null,
      revokedAt: null as Date | null,
    });

    it.each([
      ['unknown', null, 'unknown token'],
      ['already used', { ...validChange(), usedAt: new Date() }, 'already used'],
      ['revoked', { ...validChange(), revokedAt: new Date() }, 'revoked'],
      ['expired', { ...validChange(), expiresAt: new Date(Date.now() - 1) }, 'expired'],
    ])('rejects an %s link with the same 400 and audits why', async (_case, change, reason) => {
      changes.findOne.mockResolvedValue(change);

      await expect(service.confirm('raw-token', null)).rejects.toBeInstanceOf(BadRequestException);
      expect(users.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', reason }));
    });

    it('moves the account to the new address, spends the token, and keeps every session alive', async () => {
      changes.findOne.mockResolvedValue(validChange());
      users.findOne.mockResolvedValue(activeUser);

      const result = await service.confirm('raw-token', null);

      expect(result).toEqual({ email: 'new@example.com' });
      expect(users.update).toHaveBeenCalledWith({ id: 'user-1' }, { email: 'new@example.com' });
      expect(changes.update).toHaveBeenCalledWith({ id: 'change-1' }, { usedAt: expect.any(Date) });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', status: 'ok' }));
    });

    it('maps a race against another account claiming the address to 409', async () => {
      changes.findOne.mockResolvedValue(validChange());
      users.findOne.mockResolvedValue(activeUser);
      users.update.mockRejectedValue({ code: '23505' });

      await expect(service.confirm('raw-token', null)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
