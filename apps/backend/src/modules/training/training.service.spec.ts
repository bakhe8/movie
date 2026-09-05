import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ModelServiceClient, ModelServiceError, ModelServiceJob } from './model-service.client';
import { TrainingService } from './training.service';

function job(overrides: Partial<ModelServiceJob> = {}): ModelServiceJob {
  return {
    id: 'job-1',
    profileId: 'profile-1',
    status: 'queued',
    requestedAt: '2026-09-04T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    errorKind: null,
    error: null,
    result: null,
    ...overrides,
  };
}

function configMock(values: Record<string, string> = {}): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function clientMock(enabled = true) {
  return {
    enabled,
    requestTraining: vi.fn(async () => job()),
    getLatestJob: vi.fn(async () => null as ModelServiceJob | null),
    getJob: vi.fn(),
  } as unknown as ModelServiceClient & {
    requestTraining: ReturnType<typeof vi.fn>;
    getLatestJob: ReturnType<typeof vi.fn>;
  };
}

describe('TrainingService', () => {
  let profiles: { findOne: ReturnType<typeof vi.fn> };
  let triads: { count: ReturnType<typeof vi.fn> };
  let snapshots: { findOne: ReturnType<typeof vi.fn> };
  let client: ReturnType<typeof clientMock>;

  function build(config: ConfigService = configMock(), theClient = client) {
    return new TrainingService(
      profiles as never,
      triads as never,
      snapshots as never,
      theClient,
      config,
    );
  }

  beforeEach(() => {
    profiles = { findOne: vi.fn(async () => ({ id: 'profile-1', userId: 'user-1', pausedAt: null })) };
    triads = { count: vi.fn(async () => 3) };
    snapshots = { findOne: vi.fn(async () => null) };
    client = clientMock();
  });

  describe('thresholds', () => {
    it('fires at the first count and every N after it (defaults 3 and 5)', () => {
      const service = build();
      const firing = [1, 2, 3, 4, 5, 7, 8, 9, 13, 18].filter((n) => service.shouldTrainAt(n));
      expect(firing).toEqual([3, 8, 13, 18]);
      expect(service.nextTrainingAt(0)).toBe(3);
      expect(service.nextTrainingAt(3)).toBe(8);
      expect(service.nextTrainingAt(4)).toBe(8);
      expect(service.nextTrainingAt(8)).toBe(13);
    });

    it('reads both thresholds from configuration and ignores nonsense values', () => {
      const service = build(configMock({ TRAINING_FIRST_TRIAD_COUNT: '2', TRAINING_EVERY_N_TRIADS: '2' }));
      expect([1, 2, 3, 4, 5, 6].filter((n) => service.shouldTrainAt(n))).toEqual([2, 4, 6]);
      const fallback = build(configMock({ TRAINING_FIRST_TRIAD_COUNT: '0', TRAINING_EVERY_N_TRIADS: 'many' }));
      expect(fallback.firstTriadCount).toBe(3);
      expect(fallback.everyNTriads).toBe(5);
    });
  });

  describe('onTriadCompleted (automatic trigger)', () => {
    it('does nothing when the model service is not configured', async () => {
      const service = build(configMock(), clientMock(false));
      await service.onTriadCompleted('profile-1');
      expect(triads.count).not.toHaveBeenCalled();
    });

    it('requests training exactly at a threshold count', async () => {
      const service = build();
      triads.count.mockResolvedValueOnce(2);
      await service.onTriadCompleted('profile-1');
      expect(client.requestTraining).not.toHaveBeenCalled();

      triads.count.mockResolvedValueOnce(3);
      await service.onTriadCompleted('profile-1');
      expect(client.requestTraining).toHaveBeenCalledWith('profile-1');

      triads.count.mockResolvedValueOnce(8);
      await service.onTriadCompleted('profile-1');
      expect(client.requestTraining).toHaveBeenCalledTimes(2);
    });

    it('never trains a paused profile (PRIVACY.md §4 pause_all)', async () => {
      profiles.findOne.mockResolvedValueOnce({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });
      await build().onTriadCompleted('profile-1');
      expect(client.requestTraining).not.toHaveBeenCalled();
    });

    it('swallows a model-service failure instead of surfacing it to the rank request', async () => {
      client.requestTraining.mockRejectedValueOnce(new ModelServiceError('down', null));
      await expect(build().onTriadCompleted('profile-1')).resolves.toBeUndefined();
    });
  });

  describe('requestTraining (explicit)', () => {
    it('404s for a profile the caller does not own', async () => {
      profiles.findOne.mockResolvedValueOnce(null);
      await expect(build().requestTraining('attacker', 'profile-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(profiles.findOne).toHaveBeenCalledWith({ where: { id: 'profile-1', userId: 'attacker' } });
    });

    it('503s with a reason when the service is disabled', async () => {
      const service = build(configMock(), clientMock(false));
      await expect(service.requestTraining('user-1', 'profile-1')).rejects.toMatchObject({
        response: { reason: 'model_service_disabled' },
      });
    });

    it('409s for a paused profile and 400s with needed when nothing is ranked yet', async () => {
      profiles.findOne.mockResolvedValueOnce({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });
      await expect(build().requestTraining('user-1', 'profile-1')).rejects.toBeInstanceOf(ConflictException);

      triads.count.mockResolvedValue(0);
      await expect(build().requestTraining('user-1', 'profile-1')).rejects.toMatchObject({
        response: { reason: 'need_more_triads', needed: 1 },
      });
      await expect(build().requestTraining('user-1', 'profile-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns the job and whether it was newly created', async () => {
      client.getLatestJob.mockResolvedValueOnce(job({ id: 'job-1' }));
      await expect(build().requestTraining('user-1', 'profile-1')).resolves.toEqual({
        jobId: 'job-1',
        status: 'queued',
        created: false,
      });
      client.getLatestJob.mockResolvedValueOnce(null);
      await expect(build().requestTraining('user-1', 'profile-1')).resolves.toMatchObject({ created: true });
    });

    it('maps an unreachable service to 503 with a reason', async () => {
      client.requestTraining.mockRejectedValueOnce(new ModelServiceError('unreachable', null));
      const promise = build().requestTraining('user-1', 'profile-1');
      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(promise).rejects.toMatchObject({ response: { reason: 'model_service_unreachable' } });
    });
  });

  describe('status', () => {
    it('reports disabled / paused / idle / the job state, plus the next threshold and latest snapshot', async () => {
      const disabled = build(configMock(), clientMock(false));
      await expect(disabled.status('user-1', 'profile-1')).resolves.toMatchObject({
        state: 'disabled',
        nextTrainingAt: null,
        completedTriads: 3,
        latestSnapshot: null,
      });

      profiles.findOne.mockResolvedValueOnce({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });
      await expect(build().status('user-1', 'profile-1')).resolves.toMatchObject({ state: 'paused' });

      await expect(build().status('user-1', 'profile-1')).resolves.toMatchObject({ state: 'idle', nextTrainingAt: 8 });

      const created = new Date('2026-09-04T00:00:00Z');
      snapshots.findOne.mockResolvedValueOnce({ modelVersion: 'plackett-luce-v2', trainingTriadCount: 3, createdAt: created });
      client.getLatestJob.mockResolvedValueOnce(job({ status: 'succeeded' }));
      await expect(build().status('user-1', 'profile-1')).resolves.toMatchObject({
        state: 'succeeded',
        latestSnapshot: { modelVersion: 'plackett-luce-v2', trainingTriadCount: 3, createdAt: created },
      });
    });

    it('answers unknown, not an error, when the service is unreachable', async () => {
      client.getLatestJob.mockRejectedValueOnce(new ModelServiceError('down', null));
      await expect(build().status('user-1', 'profile-1')).resolves.toMatchObject({ state: 'unknown', job: null });
    });

    it('404s for a profile the caller does not own', async () => {
      profiles.findOne.mockResolvedValueOnce(null);
      await expect(build().status('attacker', 'profile-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // What travels inside a pending recommendations answer (brief P0-01): the
  // state and the failure kind, for a caller that owns the profile already.
  describe('summarize', () => {
    const profile = { id: 'profile-1', pausedAt: null };

    it('reports the latest job with its id and failure kind', async () => {
      triads.count.mockResolvedValueOnce(10);
      client.getLatestJob.mockResolvedValueOnce(job({ id: 'job-9', status: 'failed', errorKind: 'invalid', error: 'no fingerprints' }));
      await expect(build().summarize(profile)).resolves.toEqual({
        state: 'failed',
        jobId: 'job-9',
        errorKind: 'invalid',
        completedTriads: 10,
        nextTrainingAt: 13,
      });
      expect(profiles.findOne).not.toHaveBeenCalled();
    });

    it('reports disabled, paused, idle and unknown without throwing', async () => {
      await expect(build(configMock(), clientMock(false)).summarize(profile)).resolves.toMatchObject({ state: 'disabled', nextTrainingAt: null });
      await expect(build().summarize({ id: 'profile-1', pausedAt: new Date() })).resolves.toMatchObject({ state: 'paused' });
      await expect(build().summarize(profile)).resolves.toMatchObject({ state: 'idle', jobId: null, nextTrainingAt: 8 });
      client.getLatestJob.mockRejectedValueOnce(new ModelServiceError('down', null));
      await expect(build().summarize(profile)).resolves.toMatchObject({ state: 'unknown', jobId: null, errorKind: null });
    });
  });
});
