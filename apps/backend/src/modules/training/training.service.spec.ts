import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ModelServiceClient } from './model-service.client';
import type { TrainingJob } from '../../entities/training-job.entity';
import type { TrainingJobsService } from './training-jobs.service';
import { TrainingService } from './training.service';

// Since ADR-100, TrainingService never calls the model service directly for
// job lifecycle -- only `client.enabled` (a genuine "not configured at all"
// state) and TrainingJobsService's durable row. A model-service blip is
// TrainingJobsService's problem to retry, not something this class's tests
// exercise any more.
function trainingJob(overrides: Partial<TrainingJob> = {}): TrainingJob {
  return {
    id: 'job-1',
    profileId: 'profile-1',
    status: 'queued',
    attempts: 1,
    modelServiceJobId: 'python-job-1',
    nextAttemptAt: new Date('2026-09-04T00:00:00Z'),
    errorKind: null,
    lastError: null,
    result: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-09-04T00:00:00Z'),
    updatedAt: new Date('2026-09-04T00:00:00Z'),
    ...overrides,
  } as TrainingJob;
}

function configMock(values: Record<string, string> = {}): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function clientMock(enabled = true): ModelServiceClient {
  return { enabled } as unknown as ModelServiceClient;
}

function jobsMock() {
  return {
    enqueue: vi.fn(async (profileId: string) => ({ job: trainingJob({ profileId }), created: true })),
    latestForProfile: vi.fn(async () => null as TrainingJob | null),
  } as unknown as TrainingJobsService & {
    enqueue: ReturnType<typeof vi.fn>;
    latestForProfile: ReturnType<typeof vi.fn>;
  };
}

describe('TrainingService', () => {
  let profiles: { findOne: ReturnType<typeof vi.fn> };
  let triads: { count: ReturnType<typeof vi.fn> };
  let snapshots: { findOne: ReturnType<typeof vi.fn> };
  let client: ModelServiceClient;
  let jobs: ReturnType<typeof jobsMock>;

  function build(config: ConfigService = configMock(), theClient = client) {
    return new TrainingService(profiles as never, triads as never, snapshots as never, theClient, jobs, config);
  }

  beforeEach(() => {
    profiles = { findOne: vi.fn(async () => ({ id: 'profile-1', userId: 'user-1', pausedAt: null })) };
    triads = { count: vi.fn(async () => 3) };
    snapshots = { findOne: vi.fn(async () => null) };
    client = clientMock();
    jobs = jobsMock();
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
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('requests training exactly at a threshold count', async () => {
      const service = build();
      triads.count.mockResolvedValueOnce(2);
      await service.onTriadCompleted('profile-1');
      expect(jobs.enqueue).not.toHaveBeenCalled();

      triads.count.mockResolvedValueOnce(3);
      await service.onTriadCompleted('profile-1');
      expect(jobs.enqueue).toHaveBeenCalledWith('profile-1');

      triads.count.mockResolvedValueOnce(8);
      await service.onTriadCompleted('profile-1');
      expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    });

    it('never trains a paused profile (PRIVACY.md §4 pause_all)', async () => {
      profiles.findOne.mockResolvedValueOnce({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });
      await build().onTriadCompleted('profile-1');
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    // TrainingJobsService.enqueue() absorbs a model-service blip into its own
    // backoff (ADR-100) and should never throw for one, but a genuine DB
    // failure surfacing from it must still cost a log line, not a failed rank.
    it('swallows a failure from enqueue() instead of surfacing it to the rank request', async () => {
      jobs.enqueue.mockRejectedValueOnce(new Error('database unreachable'));
      await expect(build().onTriadCompleted('profile-1')).resolves.toBeUndefined();
    });
  });

  describe('ensureAutomaticTraining (derived-state read repair)', () => {
    it('idempotently schedules an eligible profile without a user command', async () => {
      await build().ensureAutomaticTraining('user-1', 'profile-1');
      expect(profiles.findOne).toHaveBeenCalledWith({ where: { id: 'profile-1', userId: 'user-1' } });
      expect(jobs.enqueue).toHaveBeenCalledExactlyOnceWith('profile-1');
    });

    it('does not schedule before the evidence threshold, while paused, or while the service is disabled', async () => {
      triads.count.mockResolvedValueOnce(2);
      await build().ensureAutomaticTraining('user-1', 'profile-1');

      profiles.findOne.mockResolvedValueOnce({ id: 'profile-1', userId: 'user-1', pausedAt: new Date() });
      await build().ensureAutomaticTraining('user-1', 'profile-1');

      await build(configMock(), clientMock(false)).ensureAutomaticTraining('user-1', 'profile-1');
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('keeps an enqueue failure operational instead of failing the readiness read', async () => {
      jobs.enqueue.mockRejectedValueOnce(new Error('database unreachable'));
      await expect(build().ensureAutomaticTraining('user-1', 'profile-1')).resolves.toBeUndefined();
    });
  });

  describe('requestTraining (compatibility/operator recovery)', () => {
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
      expect(jobs.enqueue).not.toHaveBeenCalled();
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

    // Once past the eligibility checks this always succeeds now (ADR-100):
    // a model-service blip is the queue's problem, never a 503 here.
    it('returns the enqueued job and whether it was newly created', async () => {
      jobs.enqueue.mockResolvedValueOnce({ job: trainingJob({ id: 'job-1', status: 'running' }), created: false });
      await expect(build().requestTraining('user-1', 'profile-1')).resolves.toEqual({
        jobId: 'job-1',
        status: 'running',
        created: false,
      });

      jobs.enqueue.mockResolvedValueOnce({ job: trainingJob({ id: 'job-2' }), created: true });
      await expect(build().requestTraining('user-1', 'profile-1')).resolves.toMatchObject({ jobId: 'job-2', created: true });
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
      jobs.latestForProfile.mockResolvedValueOnce(trainingJob({ status: 'succeeded' }));
      await expect(build().status('user-1', 'profile-1')).resolves.toMatchObject({
        state: 'succeeded',
        latestSnapshot: { modelVersion: 'plackett-luce-v2', trainingTriadCount: 3, createdAt: created },
      });
    });

    it('shapes the durable row exactly like the model service job the frontend already reads', async () => {
      jobs.latestForProfile.mockResolvedValueOnce(
        trainingJob({ id: 'job-9', status: 'failed', errorKind: 'invalid', lastError: 'no fingerprints' }),
      );
      const result = await build().status('user-1', 'profile-1');
      expect(result.job).toMatchObject({ id: 'job-9', status: 'failed', errorKind: 'invalid', error: 'no fingerprints' });
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
      // ADR-108: the two counts are reported apart -- ten learning rounds
      // and two repeats are not twelve pieces of evidence, and only the ten
      // move `nextTrainingAt`.
      triads.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2);
      jobs.latestForProfile.mockResolvedValueOnce(trainingJob({ id: 'job-9', status: 'failed', errorKind: 'invalid', lastError: 'no fingerprints' }));
      await expect(build().summarize(profile)).resolves.toEqual({
        state: 'failed',
        jobId: 'job-9',
        errorKind: 'invalid',
        learningRounds: 10,
        verificationRounds: 2,
        completedTriads: 10,
        nextTrainingAt: 13,
      });
      expect(profiles.findOne).not.toHaveBeenCalled();
    });

    it('reports disabled, paused and idle without throwing', async () => {
      await expect(build(configMock(), clientMock(false)).summarize(profile)).resolves.toMatchObject({ state: 'disabled', nextTrainingAt: null });
      await expect(build().summarize({ id: 'profile-1', pausedAt: new Date() })).resolves.toMatchObject({ state: 'paused' });
      await expect(build().summarize(profile)).resolves.toMatchObject({ state: 'idle', jobId: null, nextTrainingAt: 8 });
    });
  });
});
