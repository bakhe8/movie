import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { AuthService, hashRefreshToken } from './auth.service';

vi.mock('bcryptjs', () => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

function createRepositoryMock() {
  return {
    findOne: vi.fn(),
    create: vi.fn((data: Partial<User>) => data),
    save: vi.fn(async (entity: Partial<User>) => ({
      id: 'generated-id',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      active: true,
      ...entity,
    })),
  };
}

function createJwtServiceMock() {
  return {
    sign: vi.fn(() => 'signed-jwt-token'),
    decode: vi.fn(() => ({ iat: 1_000, exp: 1_900 })),
  };
}

function createRefreshRepositoryMock() {
  let nextId = 1;
  return {
    findOne: vi.fn(),
    create: vi.fn((data: Record<string, unknown>) => ({ ...data })),
    save: vi.fn(async (entity: Record<string, unknown>) => ({ id: entity.id ?? `rt-${nextId++}`, ...entity })),
    update: vi.fn(async () => ({ affected: 1 })),
  };
}

function createAuditMock() {
  return { record: vi.fn(async () => ({})), hashIp: vi.fn(() => 'ip-hash') };
}

describe('AuthService', () => {
  let usersRepository: ReturnType<typeof createRepositoryMock>;
  let refreshTokens: ReturnType<typeof createRefreshRepositoryMock>;
  let jwtService: ReturnType<typeof createJwtServiceMock>;
  let audit: ReturnType<typeof createAuditMock>;
  let service: AuthService;

  beforeEach(() => {
    usersRepository = createRepositoryMock();
    refreshTokens = createRefreshRepositoryMock();
    jwtService = createJwtServiceMock();
    audit = createAuditMock();
    service = new AuthService(
      usersRepository as unknown as Repository<User>,
      refreshTokens as never,
      jwtService as never,
      audit as never,
    );
    vi.mocked(bcrypt.hash).mockReset();
    vi.mocked(bcrypt.compare).mockReset();
  });

  describe('register', () => {
    it('hashes the password, persists the user and returns a token without the password', async () => {
      usersRepository.findOne.mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);

      const result = await service.register({
        email: 'new@example.com',
        password: 'plaintext-pw',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext-pw', 10);
      expect(usersRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed-password', email: 'new@example.com' }),
      );
      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.user).not.toHaveProperty('password');
    });

    it('rejects registering an email that already exists', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.register({ email: 'dup@example.com', password: 'x', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    // M3: findOne() then save() is a check-then-act race -- two concurrent
    // registrations for the same email can both pass the findOne check
    // before either saves. The loser must see the same 409 a sequential
    // duplicate gets, not the raw 23505 as an unhandled 500.
    it('maps a unique-constraint violation on save (a concurrent duplicate) to 409, not a raw 500', async () => {
      usersRepository.findOne.mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);
      usersRepository.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.register({ email: 'race@example.com', password: 'x', firstName: 'A', lastName: 'B' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('re-throws a save error that is not a unique-constraint violation', async () => {
      usersRepository.findOne.mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);
      const dbError = new Error('connection reset');
      usersRepository.save.mockRejectedValue(dbError);

      await expect(
        service.register({ email: 'x@example.com', password: 'x', firstName: 'A', lastName: 'B' }),
      ).rejects.toBe(dbError);
    });
  });

  describe('login', () => {
    const storedUser: User = {
      id: 'user-1',
      email: 'user@example.com',
      password: 'hashed-password',
      firstName: 'A',
      lastName: 'B',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };

    it('returns a token for valid credentials', async () => {
      usersRepository.findOne.mockResolvedValue(storedUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await service.login({ email: storedUser.email, password: 'correct' });

      expect(result.access_token).toBe('signed-jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: storedUser.id, email: storedUser.email });
      expect(result.user).not.toHaveProperty('password');
    });

    it('rejects an unknown email', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.login({ email: 'nobody@example.com', password: 'x' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an incorrect password', async () => {
      usersRepository.findOne.mockResolvedValue(storedUser);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(service.login({ email: storedUser.email, password: 'wrong' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a correct password on a deactivated account', async () => {
      usersRepository.findOne.mockResolvedValue({ ...storedUser, active: false });
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      await expect(service.login({ email: storedUser.email, password: 'correct' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('getProfile', () => {
    it('throws when the user id no longer resolves to a user', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.getProfile('missing-id')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('validateUser', () => {
    // JwtStrategy.validate() returns this value as req.user on every guarded
    // route -- the password hash must never travel with it.
    it('never returns the password hash', async () => {
      usersRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: 'hashed-password',
        firstName: 'A',
        lastName: 'B',
        active: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.validateUser('user-1');

      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({ id: 'user-1', email: 'user@example.com' });
    });

    it('returns null when the user id no longer resolves to a user', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.validateUser('missing-id')).resolves.toBeNull();
    });

    // H2: this is what every guarded request actually runs (not login()),
    // so a deactivated account whose JWT is still unexpired kept full API
    // access for the rest of its 7-day lifetime until this check existed.
    // Passport treats a null return as "authentication failed" (401), the
    // same mechanism already used for "no such user".
    it('returns null for a deactivated user, not the (still valid) JWT holder', async () => {
      usersRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        password: 'hashed-password',
        firstName: 'A',
        lastName: 'B',
        active: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      await expect(service.validateUser('user-1')).resolves.toBeNull();
    });
  });
  describe('refresh tokens (ADR-26)', () => {
    const activeUser = { id: 'user-1', email: 'a@example.com', active: true, role: 'user' };

    it('login issues a pair: a signed access token plus a random refresh token stored only as a hash', async () => {
      usersRepository.findOne.mockResolvedValue({ ...activeUser, password: 'hashed' });
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      const result = await service.login({ email: 'a@example.com', password: 'pw' }, '10.0.0.1');
      expect(result).toMatchObject({ access_token: 'signed-jwt-token', token_type: 'Bearer', expires_in: 900 });
      expect(result.refresh_token).toHaveLength(43);
      expect(refreshTokens.save).toHaveBeenCalledTimes(1);
      const stored = refreshTokens.save.mock.calls[0][0] as { id: string; familyId: string; tokenHash: string; ipHash: string };
      expect(stored.tokenHash).toBe(hashRefreshToken(result.refresh_token));
      expect(stored.tokenHash).not.toBe(result.refresh_token);
      expect(stored.ipHash).toBe('ip-hash');
      // A fresh login starts a family named after its first row.
      expect(stored.familyId).toBe(stored.id);
    });

    it('rotates: the presented token is revoked with a pointer to its replacement, same family', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 'old',
        userId: 'user-1',
        familyId: 'fam',
        tokenHash: 'h',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      usersRepository.findOne.mockResolvedValue(activeUser);
      const pair = await service.refresh('presented-token-value-xxxx');
      expect(pair.refresh_token).not.toBe('presented-token-value-xxxx');
      const created = refreshTokens.create.mock.calls[0][0] as { familyId: string };
      expect(created.familyId).toBe('fam');
      expect(refreshTokens.update).toHaveBeenCalledWith(
        { id: 'old' },
        expect.objectContaining({ revokedReason: 'rotated', replacedById: expect.any(String) }),
      );
    });

    it('treats a revoked token as reuse: revokes the family, audits, 401', async () => {
      refreshTokens.findOne.mockResolvedValue({
        id: 'old',
        userId: 'user-1',
        familyId: 'fam',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.refresh('presented-token-value-xxxx', '10.0.0.1')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam' }),
        expect.objectContaining({ revokedReason: 'reuse_detected' }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.refresh.reuse_detected', status: 'failed', actorUserId: 'user-1' }),
      );
    });

    it('refuses unknown and expired tokens without touching anything', async () => {
      refreshTokens.findOne.mockResolvedValueOnce(null);
      await expect(service.refresh('nope-nope-nope-nope-nope')).rejects.toBeInstanceOf(UnauthorizedException);
      refreshTokens.findOne.mockResolvedValueOnce({ id: 'x', userId: 'user-1', familyId: 'fam', revokedAt: null, expiresAt: new Date(Date.now() - 1) });
      await expect(service.refresh('expired-expired-expired-x')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokens.update).not.toHaveBeenCalled();
    });

    it('refuses a deactivated account at the refresh door and closes its family (H2)', async () => {
      refreshTokens.findOne.mockResolvedValue({ id: 'old', userId: 'user-1', familyId: 'fam', revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
      usersRepository.findOne.mockResolvedValue({ ...activeUser, active: false });
      await expect(service.refresh('presented-token-value-xxxx')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam' }),
        expect.objectContaining({ revokedReason: 'deactivated' }),
      );
    });

    it('logout revokes one session or all of them, and audits', async () => {
      await expect(service.logout('user-1', 'presented-token-value-xxxx', false)).resolves.toEqual({ revoked: 1 });
      expect(refreshTokens.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', tokenHash: hashRefreshToken('presented-token-value-xxxx') }),
        expect.objectContaining({ revokedReason: 'logout' }),
      );
      refreshTokens.update.mockResolvedValueOnce({ affected: 3 });
      await expect(service.logout('user-1', undefined, true)).resolves.toEqual({ revoked: 3 });
      expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'auth.logout_all', reason: 'revoked 3' }));
    });
  });
});
