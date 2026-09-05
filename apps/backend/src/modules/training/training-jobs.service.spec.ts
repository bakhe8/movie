import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { Triad } from '../../entities/triad.entity';
import { TrainingJob, TrainingJobStatus } from '../../entities/training-job.entity';
import { ModelServiceClient, ModelServiceError, ModelServiceJob } from './model-service.client';
import { MAX_ATTEMPTS, TrainingJobsService, sanitizeError } from './training-jobs.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function job(overrides: Partial<ModelServiceJob> = {}): ModelServiceJob {
  return {
    id: 'python-job-1',
    profileId: 'profile-1',
    status: 'queued',
    requestedAt: '2026-09-05T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    errorKind: null,
    error: null,
    result: null,
    ...overrides,
  };
}

// Just enough of a TypeORM repository, in memory, for the state machine to
// run without Postgres -- the same shape mail-outbox.service.spec.ts uses.
class FakeRepo {
  rows = new Map<string, TrainingJob>();
  private seq = 0;
  create = vi.fn((data: Partial<TrainingJob>) => ({ ...data }) as TrainingJob);
  save = vi.fn(async (row: TrainingJob) => {
    if (!row.id) {
      row.id = `row-${++this.seq}`;
    }
    row.createdAt = row.createdAt ?? new Date();
    row.updatedAt = new Date();
    this.rows.set(row.id, row);
    return row;
  });
  // The claim (P0-9) updates on `{ id, status: 'queued' }`, so the fake has
  // to answer `affected: 0` when the row no longer matches -- that zero is
  // the whole lock.
  update = vi.fn(async (where: { id: string; status?: TrainingJobStatus }, patch: Partial<TrainingJob>) => {
    const row = this.rows.get(where.id);
    if (!row || (where.status !== undefined && row.status !== where.status)) {
      return { affected: 0 };
    }
    Object.assign(row, patch, { updatedAt: new Date() });
    return { affected: 1 };
  });
  findOne = vi.fn(async (options: { where: { profileId?: string; id?: string; status?: { value: string[] } } }) => {
    for (const row of this.rows.values()) {
      if (options.where.profileId !== undefined && row.profileId !== options.where.profileId) continue;
      if (options.where.id !== undefined && row.id !== options.where.id) continue;
      if (options.where.status !== undefined && !options.where.status.value.includes(row.status)) continue;
      return row;
    }
    return null;
  });
  find = vi.fn(
    async (options: { where?: { status?: string | { value: string[] }; nextAttemptAt?: { value: Date } }; order?: unknown; take?: number }) => {
      let list = [...this.rows.values()];
      if (options.where?.status) {
        const status = options.where.status;
        list =
          typeof status === 'string'
            ? list.filter((row) => row.status === status)
            : list.filter((row) => status.value.includes(row.status));
      }
      if (options.where?.nextAttemptAt) {
        list = list.filter((row) => row.nextAttemptAt <= options.where!.nextAttemptAt!.value);
      }
      list.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
      return list.slice(0, options.take ?? list.length);
    },
  );
  count = vi.fn(async (options: { where: { status: string } }) =>
    [...this.rows.values()].filter((row) => row.status === options.where.status).length,
  );
  delete = vi.fn(async (where: { status: { value: string[] }; updatedAt: { value: Date } }) => {
    let affected = 0;
    for (const [id, row] of this.rows) {
      if (where.status.value.includes(row.status) && row.updatedAt < where.updatedAt.value) {
        this.rows.delete(id);
        affected += 1;
      }
    }
    return { affected };
  });
}

// Only what reconcile() calls: a chainable builder returning the profile
// ids the fake was primed with.
class FakeTriadsRepo {
  eligible: { profileId: string }[] = [];
  createQueryBuilder = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'innerJoin', 'where', 'andWhere', 'groupBy', 'having', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.getRawMany = vi.fn(async () => this.eligible);
    return builder;
  });
}

const configOf = (values: Record<string, string> = {}) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

function clientOf(overrides: Partial<Record<'requestTraining' | 'getJob', ReturnType<typeof vi.fn>>> = {}) {
  return {
    enabled: true,
    requestTraining: overrides.requestTraining ?? vi.fn(async (profileId: string) => job({ profileId })),
    getJob: overrides.getJob ?? vi.fn(async () => job({ status: 'running' })),
  } as unknown as ModelServiceClient & { requestTraining: ReturnType<typeof vi.fn>; getJob: ReturnType<typeof vi.fn> };
}

describe('sanitizeError', () => {
  it('redacts connection strings, bearer tokens and filesystem paths', () => {
    expect(sanitizeError('psycopg2.OperationalError: could not connect to postgres://user:hunter2@db.internal:5432/movie'))
      .not.toMatch(/hunter2|db\.internal/);
    expect(sanitizeError('401 from Authorization: Bearer sk-abcdef123456')).not.toContain('sk-abcdef123456');
    expect(sanitizeError('open C:\\Users\\bakheet\\.env failed')).not.toContain('bakheet');
    expect(sanitizeError('open /home/bakheet/secrets.json failed')).not.toContain('bakheet');
  });

  it('truncates to 500 characters', () => {
    expect(sanitizeError('x'.repeat(2000)).length).toBe(500);
  });
});

describe('TrainingJobsService', () => {
  let repo: FakeRepo;
  let triads: FakeTriadsRepo;
  let client: ReturnType<typeof clientOf>;
  let service: TrainingJobsService;

  beforeEach(() => {
    repo = new FakeRepo();
    triads = new FakeTriadsRepo();
    client = clientOf();
    service = new TrainingJobsService(
      repo as unknown as Repository<TrainingJob>,
      triads as unknown as Repository<Triad>,
      client,
      configOf({ NODE_ENV: 'test' }),
    );
  });

  describe('enqueue', () => {
    it('writes the row and dispatches at once when the service is reachable', async () => {
      const { job: row, created } = await service.enqueue('profile-1');
      expect(created).toBe(true);
      expect(row).toMatchObject({ profileId: 'profile-1', status: 'running', modelServiceJobId: 'python-job-1', attempts: 1 });
      expect(row.startedAt).toBeInstanceOf(Date);
      expect(client.requestTraining).toHaveBeenCalledExactlyOnceWith('profile-1');
    });

    it('is idempotent: a second call while non-terminal returns the same row', async () => {
      const first = await service.enqueue('profile-1');
      const second = await service.enqueue('profile-1');
      expect(second.created).toBe(false);
      expect(second.job.id).toBe(first.job.id);
      expect(client.requestTraining).toHaveBeenCalledTimes(1);
    });

    it('enqueues a fresh series once the previous one reached a terminal state', async () => {
      const first = await service.enqueue('profile-1');
      repo.rows.get(first.job.id)!.status = 'succeeded';
      const second = await service.enqueue('profile-1');
      expect(second.created).toBe(true);
      expect(second.job.id).not.toBe(first.job.id);
    });

    // ADR-100's whole point: a dispatch failure never surfaces as an error
    // to the caller -- the row stays queued for the sweep to retry.
    it('leaves the row queued with a sanitized error when dispatch fails, never throwing', async () => {
      client.requestTraining.mockRejectedValueOnce(new ModelServiceError('connection refused', null));
      const { job: row, created } = await service.enqueue('profile-1');
      expect(created).toBe(true);
      expect(row.status).toBe('queued');
      expect(row.attempts).toBe(1);
      expect(row.lastError).toBe('connection refused');
      expect(row.modelServiceJobId).toBeNull();
      const delay = row.nextAttemptAt.getTime() - Date.now();
      expect(delay).toBeGreaterThan(25_000);
      expect(delay).toBeLessThanOrEqual(30_000);
    });

    it('returns the winning row instead of erroring when it loses a race on the partial unique index', async () => {
      const winner = { id: 'winner', profileId: 'profile-1', status: 'running' } as TrainingJob;
      repo.rows.set('winner', winner);
      repo.save.mockRejectedValueOnce({ code: '23505' });
      const { job: row, created } = await service.enqueue('profile-1');
      expect(created).toBe(false);
      expect(row).toBe(winner);
    });
  });

  describe('runDue: polling a running job', () => {
    it('marks the row succeeded with the result once the model service finishes', async () => {
      const { job: row } = await service.enqueue('profile-1');
      client.getJob.mockResolvedValueOnce(job({ status: 'succeeded', result: { modelVersion: 'plackett-luce-v3' } as never }));

      await service.runDue();

      const saved = repo.rows.get(row.id)!;
      expect(saved.status).toBe('succeeded');
      expect(saved.result).toEqual({ modelVersion: 'plackett-luce-v3' });
      expect(saved.finishedAt).toBeInstanceOf(Date);
    });

    it('fails permanently with no retry when the model service says invalid (nothing trainable)', async () => {
      const { job: row } = await service.enqueue('profile-1');
      client.getJob.mockResolvedValueOnce(job({ status: 'failed', errorKind: 'invalid', error: 'No completed triads' }));

      await service.runDue();

      const saved = repo.rows.get(row.id)!;
      expect(saved).toMatchObject({ status: 'failed', errorKind: 'invalid', lastError: 'No completed triads' });
    });

    it('retries a transient failure with backoff instead of failing outright', async () => {
      const { job: row } = await service.enqueue('profile-1');
      client.getJob.mockResolvedValueOnce(job({ status: 'failed', errorKind: 'error', error: 'unexpected error' }));

      await service.runDue();

      const saved = repo.rows.get(row.id)!;
      expect(saved).toMatchObject({ status: 'queued', attempts: 1, errorKind: 'error', modelServiceJobId: null });
      expect(saved.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('treats a lost job (the model service forgot it) the same as a transient failure', async () => {
      const { job: row } = await service.enqueue('profile-1');
      client.getJob.mockResolvedValueOnce(null);

      await service.runDue();

      expect(repo.rows.get(row.id)).toMatchObject({ status: 'queued', attempts: 1 });
    });

    it('leaves a still-running job alone until the model service reports a terminal state', async () => {
      const { job: row } = await service.enqueue('profile-1');
      client.getJob.mockResolvedValueOnce(job({ status: 'running' }));

      await service.runDue();

      expect(repo.rows.get(row.id)!.status).toBe('running');
    });

    it('fails permanently after the attempt cap instead of retrying forever', async () => {
      // enqueue() already spent attempt 1 (dispatched, now 'running'); each
      // loop pass below both learns that attempt failed (poll, in this same
      // runDue call since the row is still 'running' at its start) and, if
      // attempts remain, redispatches for the next one (a later runDue call,
      // once its backoff has elapsed).
      const { job: row } = await service.enqueue('profile-1');
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        client.getJob.mockResolvedValueOnce(job({ status: 'failed', errorKind: 'error', error: 'still down' }));
        await service.runDue(new Date());
        if (attempt < MAX_ATTEMPTS) {
          expect(repo.rows.get(row.id)).toMatchObject({ status: 'queued', attempts: attempt });
          await service.runDue(new Date(repo.rows.get(row.id)!.nextAttemptAt.getTime() + 1));
          expect(repo.rows.get(row.id)!.status).toBe('running');
        }
      }
      expect(repo.rows.get(row.id)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, errorKind: 'error' });
    });
  });

  describe('runDue: dispatching a queued (retrying) job', () => {
    it('does not redispatch before the backoff has elapsed', async () => {
      client.requestTraining.mockRejectedValueOnce(new ModelServiceError('down', null));
      const { job: row } = await service.enqueue('profile-1');
      expect(client.requestTraining).toHaveBeenCalledTimes(1);

      await service.runDue(new Date());

      expect(client.requestTraining).toHaveBeenCalledTimes(1);
      expect(repo.rows.get(row.id)!.status).toBe('queued');
    });

    it('redispatches once due, moving the row back to running', async () => {
      client.requestTraining.mockRejectedValueOnce(new ModelServiceError('down', null));
      const { job: row } = await service.enqueue('profile-1');

      await service.runDue(new Date(row.nextAttemptAt.getTime() + 1));

      expect(client.requestTraining).toHaveBeenCalledTimes(2);
      expect(repo.rows.get(row.id)).toMatchObject({ status: 'running', modelServiceJobId: 'python-job-1' });
    });
  });

  it('purges succeeded and failed rows after the retention window, never queued or running ones', async () => {
    const { job: done } = await service.enqueue('profile-1');
    repo.rows.get(done.id)!.status = 'succeeded';
    repo.rows.get(done.id)!.updatedAt = new Date(Date.now() - 31 * DAY_MS);
    client.requestTraining.mockRejectedValueOnce(new ModelServiceError('down', null));
    const { job: pending } = await service.enqueue('profile-2');

    const result = await service.runDue();

    expect(result.purged).toBe(1);
    expect(repo.rows.has(done.id)).toBe(false);
    expect(repo.rows.has(pending.id)).toBe(true);
  });

  it('summarizes counts and the recent rows', async () => {
    await service.enqueue('profile-1');
    client.requestTraining.mockRejectedValueOnce(new ModelServiceError('down', null));
    await service.enqueue('profile-2');

    const summary = await service.summary();

    expect(summary.counts).toEqual({ queued: 1, running: 1, succeeded: 0, failed: 0 });
    expect(summary.recent).toHaveLength(2);
    for (const row of summary.recent) {
      expect(row).toHaveProperty('profileId');
      expect(row).not.toHaveProperty('modelServiceJobId');
    }
  });

  it('reads the sweep interval from configuration and never arms a timer under test or with no service configured', () => {
    expect(service.sweepIntervalMs).toBe(30_000);
    const custom = new TrainingJobsService(repo as unknown as Repository<TrainingJob>, triads as unknown as Repository<Triad>, client, configOf({ TRAINING_JOBS_SWEEP_INTERVAL_MS: '5000' }));
    expect(custom.sweepIntervalMs).toBe(5000);

    service.onModuleInit();
    expect((service as unknown as { sweepTimer: unknown }).sweepTimer).toBeNull();

    const disabledClient = { ...clientOf(), enabled: false } as unknown as ModelServiceClient;
    const disabled = new TrainingJobsService(repo as unknown as Repository<TrainingJob>, triads as unknown as Repository<Triad>, disabledClient, configOf());
    disabled.onModuleInit();
    expect((disabled as unknown as { sweepTimer: unknown }).sweepTimer).toBeNull();
  });

  // P0-9: three ways a durable queue stops being durable -- a row that stays
  // `running` for ever, two workers dispatching the same row, and a profile
  // whose enqueue was lost so no row exists at all.
  describe('P0-9: stuck rows, double execution, and profiles with no job', () => {
    const LEASE_MS = 10 * 60 * 1000;

    it('returns a job the model service never finished to the queue when its lease expires', async () => {
      const { job: row } = await service.enqueue('profile-1');
      client.getJob.mockResolvedValue({ id: 'python-job-1', profileId: 'profile-1', status: 'running', requestedAt: '', startedAt: null, finishedAt: null, errorKind: null, error: null, result: null });

      // Still inside the lease: nothing happens, the fit may simply be slow.
      await service.runDue(new Date(Date.now() + LEASE_MS - 1000));
      expect(repo.rows.get(row.id)!.status).toBe('running');

      await service.runDue(new Date(Date.now() + LEASE_MS + 1000));
      const requeued = repo.rows.get(row.id)!;
      expect(requeued.status).toBe('queued');
      expect(requeued.modelServiceJobId).toBeNull();
      expect(requeued.lastError).toMatch(/still working/);
    });

    it('returns a row claimed but never dispatched -- the worker died mid-attempt', async () => {
      const { job: row } = await service.enqueue('profile-1');
      // What a crash between claim() and the model service's answer leaves.
      repo.rows.get(row.id)!.modelServiceJobId = null;

      await service.runDue(new Date(Date.now() + LEASE_MS + 1000));

      expect(repo.rows.get(row.id)!.status).toBe('queued');
      expect(repo.rows.get(row.id)!.lastError).toMatch(/stopped before the model service accepted it/);
    });

    it('claims atomically: a row another worker already took is not dispatched twice', async () => {
      const { job: row } = await service.enqueue('profile-1');
      // Back to queued, as a retry would leave it...
      Object.assign(repo.rows.get(row.id)!, { status: 'queued', modelServiceJobId: null, nextAttemptAt: new Date(0) });
      client.requestTraining.mockClear();
      // ...but another replica claims it between this sweep's read and its
      // dispatch: the conditional UPDATE matches nothing, so we stand down.
      const stale = { ...repo.rows.get(row.id)!, status: 'queued' as const };
      repo.rows.get(row.id)!.status = 'running';

      await service['dispatch'](stale, new Date());

      expect(client.requestTraining).not.toHaveBeenCalled();
    });

    it('reconciles a profile that qualifies but has no job and no model', async () => {
      triads.eligible = [{ profileId: 'profile-lost' }];

      const result = await service.runDue();

      expect(result.reconciled).toBe(1);
      expect(client.requestTraining).toHaveBeenCalledWith('profile-lost');
      expect([...repo.rows.values()].some((r) => r.profileId === 'profile-lost')).toBe(true);
    });

    it('does not enqueue twice for a profile the reconciler picks up again', async () => {
      triads.eligible = [{ profileId: 'profile-lost' }];
      await service.runDue();
      client.requestTraining.mockClear();

      const second = await service.runDue();

      expect(second.reconciled).toBe(0);
      expect(client.requestTraining).not.toHaveBeenCalled();
    });
  });
});
