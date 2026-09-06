import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminJob, AdminJobStatus } from '../../entities/admin-job.entity';
import { AdminJobsService, MAX_ATTEMPTS, NonRetryableJobError } from './admin-jobs.service';

// Just enough of a TypeORM repository, in memory, for the claim/dispatch
// state machine to run without Postgres -- same shape as
// training-jobs.service.spec.ts's FakeRepo, adapted to AdminJob's shape.
class FakeRepo {
  rows = new Map<string, AdminJob>();
  private seq = 0;
  create = vi.fn((data: Partial<AdminJob>) => ({ ...data }) as AdminJob);
  save = vi.fn(async (row: AdminJob) => {
    if (this.forceDuplicateOnce) {
      const winner = this.forceDuplicateOnce;
      this.forceDuplicateOnce = null;
      this.rows.set(winner.id, winner);
      throw { code: '23505' };
    }
    if (!row.id) row.id = `row-${++this.seq}`;
    row.createdAt = row.createdAt ?? new Date();
    row.updatedAt = new Date();
    this.rows.set(row.id, row);
    return row;
  });
  // The claim is `UPDATE ... WHERE id = ? AND status = 'queued'` -- the fake
  // answers `affected: 0` the moment that no longer matches, which is the
  // entire single-winner guarantee under test.
  update = vi.fn(async (where: { id: string; status?: AdminJobStatus }, patch: Partial<AdminJob>) => {
    const row = this.rows.get(where.id);
    if (!row || (where.status !== undefined && row.status !== where.status)) {
      return { affected: 0 };
    }
    Object.assign(row, patch, { updatedAt: new Date() });
    return { affected: 1 };
  });
  // `forceDuplicateOnce`: the next save() throws a 23505 as if a partial
  // unique index refused it, and inserts this row first -- simulates a
  // second, concurrent caller's INSERT winning the race between this
  // caller's own read (found nothing) and its write.
  forceDuplicateOnce: AdminJob | null = null;
  findOne = vi.fn(async (options: { where: { id?: string; idempotencyKey?: string; type?: string; status?: string | { value: string[] } } }) => {
    for (const row of this.rows.values()) {
      if (options.where.id !== undefined && row.id !== options.where.id) continue;
      if (options.where.idempotencyKey !== undefined && row.idempotencyKey !== options.where.idempotencyKey) continue;
      if (options.where.type !== undefined && row.type !== options.where.type) continue;
      if (options.where.status !== undefined) {
        const status = options.where.status;
        const matches = typeof status === 'string' ? row.status === status : status.value.includes(row.status);
        if (!matches) continue;
      }
      return row;
    }
    return null;
  });
  find = vi.fn(
    async (options: { where?: { status?: string; updatedAt?: { value: Date }; nextAttemptAt?: { value: Date } }; take?: number }) => {
      let list = [...this.rows.values()];
      if (options.where?.status) list = list.filter((row) => row.status === options.where!.status);
      if (options.where?.updatedAt) list = list.filter((row) => row.updatedAt < options.where!.updatedAt!.value);
      if (options.where?.nextAttemptAt) list = list.filter((row) => row.nextAttemptAt <= options.where!.nextAttemptAt!.value);
      return list.slice(0, options.take ?? list.length);
    },
  );
  findAndCount = vi.fn(async (options: { where?: { type?: string; status?: string }; skip?: number; take?: number }) => {
    let list = [...this.rows.values()];
    if (options.where?.type) list = list.filter((row) => row.type === options.where!.type);
    if (options.where?.status) list = list.filter((row) => row.status === options.where!.status);
    const total = list.length;
    return [list.slice(options.skip ?? 0, (options.skip ?? 0) + (options.take ?? total)), total] as const;
  });
  delete = vi.fn(async (where: { status: AdminJobStatus; updatedAt: { value: Date } }) => {
    let affected = 0;
    for (const [id, row] of this.rows) {
      if (row.status === where.status && row.updatedAt < where.updatedAt.value) {
        this.rows.delete(id);
        affected += 1;
      }
    }
    return { affected };
  });
}

const actor = { id: 'admin-1', role: 'admin', ip: null };
const configOf = (values: Record<string, string> = {}) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

function serviceOf() {
  const rows = new FakeRepo();
  const audit = { record: vi.fn(async () => ({})) };
  const service = new AdminJobsService(
    rows as never,
    {} as never, // titles -- unused by any test here (the handler itself is covered by republish-fingerprint.lib.spec.ts)
    {} as never, // features
    audit as never,
    configOf({ NODE_ENV: 'test' }),
  );
  return { service, rows, audit };
}

describe('AdminJobsService.create', () => {
  it('refuses an unregistered job type without creating a row', async () => {
    const { service, rows } = serviceOf();
    await expect(service.create({ type: 'delete_everything' }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(rows.rows.size).toBe(0);
  });

  it('returns the existing row for a repeated idempotencyKey instead of starting a second one', async () => {
    const { service } = serviceOf();
    const first = await service.create({ type: 'republish_fingerprints', idempotencyKey: 'nightly-2026-09-06' }, actor);
    const second = await service.create({ type: 'republish_fingerprints', idempotencyKey: 'nightly-2026-09-06' }, actor);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it('audits the creation with the type and dry-run flag', async () => {
    const { service, audit } = serviceOf();
    await service.create({ type: 'republish_fingerprints', dryRun: true }, actor);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.job.create', actorUserId: 'admin-1', reason: expect.stringContaining('dry run') }),
    );
  });

  // W8 secrets audit: `params` is a caller-controlled bag with no key
  // allowlist, echoed into the audit log's free-text reason for a human to
  // read -- a key that merely looks like a credential must never reach it.
  it('redacts a credential-shaped param key before writing it to the audit log', async () => {
    const { service, audit } = serviceOf();
    await service.create({ type: 'republish_fingerprints', params: { titleId: 'abc', password: 'hunter2', apiKey: 'sk-live-xyz' } }, actor);
    const call = audit.record.mock.calls[0][0] as { reason: string };
    expect(call.reason).toContain('"titleId":"abc"');
    expect(call.reason).not.toContain('hunter2');
    expect(call.reason).not.toContain('sk-live-xyz');
    expect(call.reason).toContain('"password":"[redacted]"');
    expect(call.reason).toContain('"apiKey":"[redacted]"');
  });

  it('redacts a credential-shaped param key in the create() response too, not only the audit log', async () => {
    const { service } = serviceOf();
    const { job } = await service.create({ type: 'republish_fingerprints', params: { titleId: 'abc', password: 'hunter2' } }, actor);
    expect(job.params).toEqual({ titleId: 'abc', password: '[redacted]' });
  });

  it('redacts in list() and get() as well', async () => {
    const { service, rows } = serviceOf();
    const { job } = await service.create({ type: 'republish_fingerprints', params: { secret: 'x' } }, actor);
    expect((await service.get(job.id)).params).toEqual({ secret: '[redacted]' });
    const list = await service.list({ page: 1, limit: 10 } as never);
    expect(list.items[0].params).toEqual({ secret: '[redacted]' });
    // The stored row itself keeps the real value -- a handler dispatched
    // against it must still see the real secret, only the HTTP-facing view
    // is redacted.
    expect(rows.rows.get(job.id)!.params).toEqual({ secret: 'x' });
  });

  // Item 5: one non-terminal job per type at a time.
  it('refuses a second job of a type that already has a non-terminal one', async () => {
    const { service } = serviceOf();
    const { job } = await service.create({ type: 'republish_fingerprints' }, actor);
    await expect(service.create({ type: 'republish_fingerprints' }, actor)).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'type_busy', existingJobId: job.id }),
    });
  });

  // Item 2: the DB-level race -- two concurrent creates both pass the
  // pre-checks (neither sees the other's row yet), then one INSERT wins and
  // the other's partial unique index violation is caught and turned into the
  // winner's row, not a raw 500.
  it('recovers from a raced duplicate idempotencyKey insert instead of throwing a raw 500', async () => {
    const { service, rows } = serviceOf();
    const winner = {
      id: 'winner-1', type: 'republish_fingerprints', status: 'queued', dryRun: false, params: null,
      attempts: 0, nextAttemptAt: new Date(), idempotencyKey: 'k1', requestedBy: 'admin-1', trigger: 'admin',
      cancelRequested: false, progress: null, result: null, lastError: null, startedAt: null, finishedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as AdminJob;
    rows.forceDuplicateOnce = winner;
    const result = await service.create({ type: 'republish_fingerprints', idempotencyKey: 'k1' }, actor);
    expect(result.created).toBe(false);
    expect(result.job.id).toBe('winner-1');
  });

  it('recovers from a raced duplicate type-exclusivity insert with the same 409 a synchronous check would give', async () => {
    const { service, rows } = serviceOf();
    const winner = {
      id: 'winner-2', type: 'republish_fingerprints', status: 'running', dryRun: false, params: null,
      attempts: 1, nextAttemptAt: new Date(), idempotencyKey: null, requestedBy: 'admin-1', trigger: 'admin',
      cancelRequested: false, progress: null, result: null, lastError: null, startedAt: new Date(), finishedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as AdminJob;
    rows.forceDuplicateOnce = winner;
    await expect(service.create({ type: 'republish_fingerprints' }, actor)).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'type_busy', existingJobId: 'winner-2' }),
    });
  });

  it('rejects params a type declares invalid before writing any row', async () => {
    const { service, rows } = serviceOf();
    await expect(service.create({ type: 'republish_fingerprints', params: { titleId: 42 } }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.rows.size).toBe(0);
  });

  // Item 1/9: a schedule-triggered call has no signed-in admin behind it.
  it('records a null-actor call as a schedule trigger with no requestedBy, and audits it as system', async () => {
    const { service, audit } = serviceOf();
    const { job } = await service.create({ type: 'republish_fingerprints' }, null);
    expect(job.trigger).toBe('schedule');
    expect(job.requestedBy).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: null, actorRole: 'system' }));
  });
});

describe('AdminJobsService.registerType', () => {
  it('refuses to register the same type key twice', () => {
    const { service } = serviceOf();
    expect(() => service.registerType({ key: 'republish_fingerprints', description: 'x', handler: async () => ({}) })).toThrow();
  });

  it('lets another module extend the allowlist', () => {
    const { service } = serviceOf();
    service.registerType({ key: 'catalog_pull', description: 'يسحب بيانات جديدة من مصدر خارجي.', handler: async () => ({}) });
    expect(service.listTypes().map((t) => t.type)).toEqual(expect.arrayContaining(['republish_fingerprints', 'catalog_pull']));
  });
});

describe('AdminJobsService claim/dispatch', () => {
  it('lets only one of two racing dispatches claim the same row', async () => {
    const { service, rows } = serviceOf();
    const row = rows.create({ id: 'j1', type: 'republish_fingerprints', status: 'queued', attempts: 0, nextAttemptAt: new Date(), params: {} });
    await rows.save(row);
    // Both dispatch calls read the same pre-claim row; only the update whose
    // WHERE still matches ('queued') succeeds -- exactly runDue() racing a
    // create()-time dispatch for the same row.
    const claimA = await (service as unknown as { claim: (r: AdminJob, now: Date) => Promise<AdminJob | null> }).claim(row, new Date());
    const claimB = await (service as unknown as { claim: (r: AdminJob, now: Date) => Promise<AdminJob | null> }).claim(row, new Date());
    expect(claimA).not.toBeNull();
    expect(claimB).toBeNull();
  });

  // Item 9/J1-1: a handler that knows its own failure is deterministic
  // throws NonRetryableJobError instead of burning the whole backoff ladder
  // on a certain repeat.
  it('fails a job at once on a NonRetryableJobError, skipping the backoff ladder', async () => {
    const { service, rows } = serviceOf();
    service.registerType({
      key: 'always_fails',
      description: 'x',
      handler: async () => {
        throw new NonRetryableJobError('this input can never succeed');
      },
    });
    const row = await rows.save(rows.create({ id: 'j1', type: 'always_fails', status: 'queued', attempts: 0, nextAttemptAt: new Date() }));
    await (service as unknown as { dispatch: (r: AdminJob) => Promise<void> }).dispatch(row);
    const saved = rows.rows.get('j1')!;
    expect(saved.status).toBe('failed');
    expect(saved.attempts).toBe(1);
    expect(saved.lastError).toContain('this input can never succeed');
  });
});

describe('AdminJobsService.cancel', () => {
  it('ends a queued job at once, before it ever runs', async () => {
    const { service, rows } = serviceOf();
    const row = await rows.save(rows.create({ id: 'j1', type: 'republish_fingerprints', status: 'queued', attempts: 0, nextAttemptAt: new Date() }));
    const cancelled = await service.cancel(row.id, actor);
    expect(cancelled.status).toBe('cancelled');
  });

  it('marks a running job cooperatively cancelled rather than stopping it unsafely', async () => {
    const { service, rows } = serviceOf();
    const row = await rows.save(rows.create({ id: 'j1', type: 'republish_fingerprints', status: 'running', attempts: 1, nextAttemptAt: new Date() }));
    const result = await service.cancel(row.id, actor);
    expect(result.status).toBe('running');
    expect(result.cancelRequested).toBe(true);
  });

  it('refuses to cancel an already-terminal job', async () => {
    const { service, rows } = serviceOf();
    const row = await rows.save(rows.create({ id: 'j1', type: 'republish_fingerprints', status: 'succeeded', attempts: 1, nextAttemptAt: new Date() }));
    await expect(service.cancel(row.id, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s for an unknown job', async () => {
    const { service } = serviceOf();
    await expect(service.cancel('ghost', actor)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminJobsService retry/backoff', () => {
  it('fails permanently after MAX_ATTEMPTS, and retries with backoff before that', async () => {
    const { service, rows } = serviceOf();
    const retryOrFail = (service as unknown as { retryOrFail: (r: AdminJob, a: number, m: string, n: Date) => Promise<void> }).retryOrFail.bind(service);
    const row = await rows.save(rows.create({ id: 'j1', type: 'republish_fingerprints', status: 'running', attempts: 1, nextAttemptAt: new Date() }));

    await retryOrFail(row, 1, 'transient error', new Date());
    expect(rows.rows.get('j1')!.status).toBe('queued');

    await retryOrFail(row, MAX_ATTEMPTS, 'permanent error', new Date());
    expect(rows.rows.get('j1')!.status).toBe('failed');
  });
});

describe('AdminJobsService.listTypes', () => {
  it('exposes the allowlist, never a free-text type', () => {
    const { service } = serviceOf();
    const types = service.listTypes();
    expect(types.map((t) => t.type)).toEqual(['republish_fingerprints']);
    expect(types[0].description.length).toBeGreaterThan(0);
  });
});
