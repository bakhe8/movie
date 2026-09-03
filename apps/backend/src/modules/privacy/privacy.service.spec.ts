import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrivacyService, subjectKeyFor } from './privacy.service';

function configMock(values: Record<string, string> = {}): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('PrivacyService', () => {
  const password = 'CorrectHorseBattery1';
  let user: { id: string; active: boolean; password: string; role: string };
  let users: { findOne: ReturnType<typeof vi.fn> };
  let profiles: { findOne: ReturnType<typeof vi.fn> };
  let requests: { findOne: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> };
  let manager: Record<string, ReturnType<typeof vi.fn>>;
  let dataSource: { transaction: ReturnType<typeof vi.fn> };
  let audit: { record: ReturnType<typeof vi.fn> };

  function build(config: ConfigService = configMock()) {
    return new PrivacyService(users as never, profiles as never, requests as never, dataSource as never, audit as never, config);
  }

  beforeEach(async () => {
    user = { id: 'user-1', active: true, password: await bcrypt.hash(password, 4), role: 'user' };
    users = { findOne: vi.fn(async () => user) };
    profiles = { findOne: vi.fn(async () => ({ id: 'profile-1', userId: 'user-1' })) };
    requests = { findOne: vi.fn(async () => null), find: vi.fn(async () => []) };
    manager = {
      find: vi.fn(async () => []),
      findOne: vi.fn(),
      count: vi.fn(async () => 0),
      create: vi.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'req-1', ...data })),
      save: vi.fn(async (entity: unknown) => entity),
      update: vi.fn(async () => ({ affected: 1 })),
      delete: vi.fn(async () => ({ affected: 2 })),
    };
    dataSource = { transaction: vi.fn(async (run: (m: unknown) => Promise<unknown>) => run(manager)) };
    audit = { record: vi.fn(async () => ({})) };
  });

  it('derives a stable pseudonymous subject key', () => {
    expect(subjectKeyFor('user-1')).toHaveLength(64);
    expect(subjectKeyFor('user-1')).toBe(subjectKeyFor('user-1'));
    expect(subjectKeyFor('user-2')).not.toBe(subjectKeyFor('user-1'));
  });

  it('reads the safety period and sweep interval from configuration', () => {
    expect(build().safetyDays).toBe(7);
    const custom = build(configMock({ PRIVACY_DELETE_SAFETY_DAYS: '0', PRIVACY_SWEEP_INTERVAL_MS: '0' }));
    expect(custom.safetyDays).toBe(0);
    expect(custom.sweepIntervalMs).toBe(0);
    expect(build(configMock({ PRIVACY_DELETE_SAFETY_DAYS: '-3' })).safetyDays).toBe(7);
  });

  describe('re-verification', () => {
    it('rejects a wrong password with 403 and audits the failure', async () => {
      await expect(build().requestDelete('user-1', 'wrong', '10.0.0.1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'privacy.delete', status: 'failed', reason: 'reverification_failed', ip: '10.0.0.1' }),
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('treats a deactivated or missing account as not found', async () => {
      user.active = false;
      await expect(build().export('user-1', password, null)).rejects.toBeInstanceOf(NotFoundException);
      users.findOne.mockResolvedValueOnce(null);
      await expect(build().export('user-1', password, null)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('requestDelete', () => {
    it('returns the pending request instead of scheduling a second one', async () => {
      requests.findOne.mockResolvedValueOnce({ id: 'pending', status: 'scheduled' });
      await expect(build().requestDelete('user-1', password, null)).resolves.toMatchObject({ id: 'pending' });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('schedules after the safety period, pauses the unpaused profiles and audits', async () => {
      manager.find.mockResolvedValueOnce([{ id: 'profile-1' }, { id: 'profile-2' }]);
      const before = Date.now();
      const request = await build().requestDelete('user-1', password, '10.0.0.1');
      expect(request).toMatchObject({ type: 'delete', status: 'scheduled', subjectKey: subjectKeyFor('user-1') });
      expect((request.executeAfter as Date).getTime()).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
      expect(request.executionLog).toMatchObject({ safetyDays: 7, pausedProfileIds: ['profile-1', 'profile-2'] });
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), expect.anything(), { pausedAt: expect.any(Date) });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.delete.scheduled', status: 'scheduled' }), manager);
    });

    it('purges immediately when the safety period is zero', async () => {
      manager.findOne.mockResolvedValueOnce({ id: 'req-1', userId: 'user-1', status: 'scheduled', executionLog: {} });
      manager.find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'profile-1' }]);
      const request = await build(configMock({ PRIVACY_DELETE_SAFETY_DAYS: '0' })).requestDelete('user-1', password, null);
      expect(request).toMatchObject({ status: 'done', userId: null });
      expect(manager.delete).toHaveBeenCalledWith(expect.anything(), { id: 'user-1' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'privacy.delete.executed', actorUserId: null, actorRole: 'system', resourceId: 'user-1' }),
        manager,
      );
    });
  });

  describe('cancelDelete', () => {
    it('404s for a request that is not the caller\'s and 409s once it is no longer scheduled', async () => {
      await expect(build().cancelDelete('user-1', 'req-x', null)).rejects.toBeInstanceOf(NotFoundException);
      requests.findOne.mockResolvedValueOnce({ id: 'req-1', status: 'done', executionLog: {} });
      await expect(build().cancelDelete('user-1', 'req-1', null)).rejects.toBeInstanceOf(ConflictException);
    });

    it('resumes only the profiles this request paused', async () => {
      requests.findOne.mockResolvedValueOnce({ id: 'req-1', status: 'scheduled', executionLog: { pausedProfileIds: ['profile-1'] } });
      const cancelled = await build().cancelDelete('user-1', 'req-1', null);
      expect(cancelled).toMatchObject({ status: 'cancelled' });
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'user-1' }), { pausedAt: null });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.delete.cancelled' }), manager);
    });
  });

  describe('reset', () => {
    it('404s for a profile the caller does not own', async () => {
      profiles.findOne.mockResolvedValueOnce(null);
      await expect(build().reset('user-1', 'profile-1', null)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes recommendations, triads and snapshots for that profile only and records the counts', async () => {
      const result = await build().reset('user-1', 'profile-1', null);
      expect(result.deleted).toEqual({ recommendations: 2, triads: 2, modelSnapshots: 2 });
      expect(manager.delete).toHaveBeenCalledTimes(3);
      for (const call of manager.delete.mock.calls) {
        expect(call[1]).toEqual({ profileId: 'profile-1' });
      }
      expect(result.request).toMatchObject({ type: 'reset', status: 'done', profileId: 'profile-1' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'privacy.reset', resource: 'profile', resourceId: 'profile-1' }), manager);
    });
  });

  describe('runDue', () => {
    it('executes each due request and keeps going after one fails', async () => {
      requests.find.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      manager.findOne
        .mockResolvedValueOnce({ id: 'a', userId: 'user-a', status: 'scheduled', executionLog: {} })
        .mockResolvedValueOnce({ id: 'b', userId: 'user-b', status: 'scheduled', executionLog: {} });
      manager.delete.mockResolvedValueOnce({ affected: 1 }).mockRejectedValueOnce(new Error('db down'));
      await expect(build().runDue()).resolves.toBe(1);
    });

    it('skips a request that was cancelled between the query and the run', async () => {
      requests.find.mockResolvedValueOnce([{ id: 'a' }]);
      manager.findOne.mockResolvedValueOnce({ id: 'a', userId: 'user-a', status: 'cancelled' });
      await expect(build().runDue()).resolves.toBe(1);
      expect(manager.delete).not.toHaveBeenCalled();
    });
  });
});
