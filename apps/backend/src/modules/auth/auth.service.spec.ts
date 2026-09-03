import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { AuthService } from './auth.service';

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
  return { sign: vi.fn(() => 'signed-jwt-token') };
}

describe('AuthService', () => {
  let usersRepository: ReturnType<typeof createRepositoryMock>;
  let jwtService: ReturnType<typeof createJwtServiceMock>;
  let service: AuthService;

  beforeEach(() => {
    usersRepository = createRepositoryMock();
    jwtService = createJwtServiceMock();
    service = new AuthService(usersRepository as unknown as Repository<User>, jwtService as never);
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
});
