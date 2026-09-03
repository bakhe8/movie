import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { AuthService } from './auth.service';

vi.mock('bcrypt', () => ({
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
});
