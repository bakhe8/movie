import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { Consent } from '../../entities/consent.entity';
import { ConsentsService } from './consents.service';

function repoMock() {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn((entity: Partial<Consent>) => entity as Consent),
    save: vi.fn(async (entity: Consent) => entity),
  };
}

describe('ConsentsService', () => {
  let consentsRepository: ReturnType<typeof repoMock>;
  let service: ConsentsService;

  beforeEach(() => {
    consentsRepository = repoMock();
    service = new ConsentsService(consentsRepository as unknown as Repository<Consent>);
  });

  describe('findForUser', () => {
    it("returns only the caller's own rows, newest grant first", async () => {
      const rows = [{ id: 'c1' }] as Consent[];
      consentsRepository.find.mockResolvedValue(rows);

      const result = await service.findForUser('user-1');

      expect(consentsRepository.find).toHaveBeenCalledWith({ where: { userId: 'user-1' }, order: { grantedAt: 'DESC' } });
      expect(result).toBe(rows);
    });
  });

  describe('update', () => {
    it('creates a new row with grantedAt set and revokedAt null when granting for the first time', async () => {
      consentsRepository.findOne.mockResolvedValue(null);

      const [result] = await service.update('user-1', [{ purpose: 'watch_history', version: 'privacy-2.0', granted: true }]);

      expect(consentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', purpose: 'watch_history', version: 'privacy-2.0', granted: true, revokedAt: null }),
      );
      expect(result.grantedAt).toBeInstanceOf(Date);
      expect(result.revokedAt).toBeNull();
    });

    it('creates a new row with revokedAt set when declining for the first time (never granted)', async () => {
      consentsRepository.findOne.mockResolvedValue(null);

      const [result] = await service.update('user-1', [{ purpose: 'analytics_first_party', version: 'privacy-2.0', granted: false }]);

      expect(result.granted).toBe(false);
      expect(result.revokedAt).toBeInstanceOf(Date);
    });

    it('flips an existing grant to revoked and stamps revokedAt, keeping the original grantedAt', async () => {
      const originalGrantedAt = new Date('2026-01-01T00:00:00.000Z');
      const existing = {
        id: 'c1',
        userId: 'user-1',
        purpose: 'personalization_pooled',
        version: 'privacy-2.0',
        granted: true,
        grantedAt: originalGrantedAt,
        revokedAt: null,
      } as Consent;
      consentsRepository.findOne.mockResolvedValue(existing);

      const [result] = await service.update('user-1', [
        { purpose: 'personalization_pooled', version: 'privacy-2.0', granted: false },
      ]);

      expect(result.granted).toBe(false);
      expect(result.grantedAt).toBe(originalGrantedAt);
      expect(result.revokedAt).toBeInstanceOf(Date);
      expect(consentsRepository.create).not.toHaveBeenCalled();
    });

    it('re-granting a revoked purpose clears revokedAt without touching the original grantedAt', async () => {
      const originalGrantedAt = new Date('2026-01-01T00:00:00.000Z');
      const existing = {
        id: 'c1',
        userId: 'user-1',
        purpose: 'personalization_pooled',
        version: 'privacy-2.0',
        granted: false,
        grantedAt: originalGrantedAt,
        revokedAt: new Date('2026-02-01T00:00:00.000Z'),
      } as Consent;
      consentsRepository.findOne.mockResolvedValue(existing);

      const [result] = await service.update('user-1', [
        { purpose: 'personalization_pooled', version: 'privacy-2.0', granted: true },
      ]);

      expect(result.granted).toBe(true);
      expect(result.grantedAt).toBe(originalGrantedAt);
      expect(result.revokedAt).toBeNull();
    });

    it('is a no-op (no save call) when the requested state already matches', async () => {
      const existing = {
        id: 'c1',
        userId: 'user-1',
        purpose: 'watch_history',
        version: 'privacy-2.0',
        granted: true,
        grantedAt: new Date(),
        revokedAt: null,
      } as Consent;
      consentsRepository.findOne.mockResolvedValue(existing);

      await service.update('user-1', [{ purpose: 'watch_history', version: 'privacy-2.0', granted: true }]);

      expect(consentsRepository.save).not.toHaveBeenCalled();
    });

    it('processes multiple purposes in one call, each against its own (userId, purpose, version) row', async () => {
      consentsRepository.findOne.mockResolvedValue(null);

      const results = await service.update('user-1', [
        { purpose: 'watch_history', version: 'privacy-2.0', granted: true },
        { purpose: 'personalization_individual', version: 'privacy-2.0', granted: true },
      ]);

      expect(results).toHaveLength(2);
      expect(consentsRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', purpose: 'watch_history', version: 'privacy-2.0' },
      });
      expect(consentsRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', purpose: 'personalization_individual', version: 'privacy-2.0' },
      });
    });
  });
});
