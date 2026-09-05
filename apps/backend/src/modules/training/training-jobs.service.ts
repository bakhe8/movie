import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { Triad } from '../../entities/triad.entity';
import { TrainingJob, TrainingJobErrorKind, TrainingJobStatus } from '../../entities/training-job.entity';
import { captureException } from '../../observability/observability';
import { ModelServiceClient, ModelServiceError } from './model-service.client';
import { firstTriadCountFrom } from './training-thresholds';

export interface TrainingJobSummaryRow {
  id: string;
  profileId: string;
  status: TrainingJobStatus;
  attempts: number;
  errorKind: TrainingJobErrorKind | null;
  lastError: string | null;
  nextAttemptAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainingJobsSummary {
  counts: Record<TrainingJobStatus, number>;
  recent: TrainingJobSummaryRow[];
}

// Attempt n (1-based) that fails transiently waits BACKOFF_MS[n - 1] before
// the next; after MAX_ATTEMPTS the row is permanently failed. Same shape as
// the mail outbox's (ADR-97) -- roughly an hour of retrying in total, long
// enough to ride out a model-service redeploy.
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
const SWEEP_BATCH = 20;
// Job history is diagnostic, not personal data (profileId is pseudonymous,
// the stored error is sanitized) -- kept longer than mail's 7 days since
// there is no privacy reason to shorten it, only storage hygiene.
const RETENTION_DAYS = 30;
// How long a row may stay `running` before the sweep takes it back. A claim
// (see claim()) is a lease, not a permanent assignment: the worker that took
// the row can die between claiming it and recording the model service's job
// id, and the model service itself can accept a job and never finish it.
// Either way the row returns to the queue with a backoff and its attempt
// counted -- so it either succeeds on a later attempt or fails visibly after
// MAX_ATTEMPTS, instead of sitting `running` for ever (P0-9). Longer than any
// fit this trainer performs (a profile's Plackett-Luce fit is seconds), short
// enough that a stuck job is caught inside one user's session.
const RUNNING_LEASE_MS = 10 * 60 * 1000;
const LAST_ERROR_MAX = 500;

// Text a raw exception or a model-service error body could plausibly carry
// and must never reach the `training_jobs` row the frontend and admin board
// read: connection strings, bearer tokens, file paths.
const CONNECTION_STRING_PATTERN = /\b\w+:\/\/[^\s]*@[^\s]+/g;
const BEARER_PATTERN = /\bBearer\s+\S+/gi;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s]+/g;
const UNIX_PATH_PATTERN = /\/(?:home|Users|var|usr)\/[^\s]+/g;

export function sanitizeError(message: string): string {
  return message
    .replace(CONNECTION_STRING_PATTERN, '[redacted-connection]')
    .replace(BEARER_PATTERN, '[redacted-token]')
    .replace(WINDOWS_PATH_PATTERN, '[redacted-path]')
    .replace(UNIX_PATH_PATTERN, '[redacted-path]')
    .slice(0, LAST_ERROR_MAX);
}

// ADR-100 (remediation brief P0-02): a durable outer layer around the model
// service's own async job (ADR-25) -- mirroring the mail outbox (ADR-97).
// `enqueue()` writes the row and dispatches to the model service at once,
// so the common case (service reachable) is still one round trip; a
// dispatch failure, an unreachable poll, or a lost job (the model service
// restarted and forgot it, `getJob` returning null) all leave the row
// `queued` for the sweep to retry with backoff -- never a 5xx to the caller
// for a transient blip, and never silence: a permanent failure is `failed`
// with a sanitized reason and a job id the frontend/admin can show.
@Injectable()
export class TrainingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrainingJobsService.name);
  readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;

  private readonly firstTriadCount: number;

  constructor(
    @InjectRepository(TrainingJob)
    private readonly rows: Repository<TrainingJob>,
    @InjectRepository(Triad)
    private readonly triads: Repository<Triad>,
    private readonly client: ModelServiceClient,
    private readonly config: ConfigService,
  ) {
    const raw = Number(config.get<string>('TRAINING_JOBS_SWEEP_INTERVAL_MS'));
    this.sweepIntervalMs = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SWEEP_INTERVAL_MS;
    this.firstTriadCount = firstTriadCountFrom(config);
  }

  // Disabled under test so suites drive runDue() by hand; disabled with
  // TRAINING_JOBS_SWEEP_INTERVAL_MS=0 when an external scheduler owns it.
  onModuleInit(): void {
    if (this.sweepIntervalMs === 0 || this.config.get<string>('NODE_ENV') === 'test' || !this.client.enabled) {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.runDue().catch((error: unknown) => {
        this.logger.error(`training-jobs sweep failed: ${this.describe(error)}`);
        captureException(error, { stage: 'training-jobs.sweep' });
      });
    }, this.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // Idempotent: a profile with a non-terminal row already gets that one
  // back (created: false) instead of a second attempt series.
  async enqueue(profileId: string): Promise<{ job: TrainingJob; created: boolean }> {
    const existing = await this.rows.findOne({ where: { profileId, status: In(['queued', 'running']) } });
    if (existing) {
      return { job: existing, created: false };
    }
    let row = this.rows.create({ profileId, status: 'queued', attempts: 0, nextAttemptAt: new Date() });
    try {
      row = await this.rows.save(row);
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      // Lost a race to a concurrent enqueue() for the same profile -- the
      // partial unique index refused the second INSERT; the winner's row is
      // the current one (same lost-race shape as TriadsService.getCurrent()).
      const winner = await this.rows.findOne({ where: { profileId, status: In(['queued', 'running']) } });
      if (!winner) {
        throw error;
      }
      return { job: winner, created: false };
    }
    return { job: await this.dispatch(row), created: true };
  }

  async latestForProfile(profileId: string): Promise<TrainingJob | null> {
    return this.rows.findOne({ where: { profileId }, order: { createdAt: 'DESC' } });
  }

  // Every running row polled, every queued row whose backoff has elapsed
  // dispatched, then the retention purge -- one unit of the sweep's work,
  // also callable directly (tests, an external scheduler).
  async runDue(now: Date = new Date()): Promise<{ polled: number; dispatched: number; reconciled: number; purged: number }> {
    if (this.sweeping) {
      return { polled: 0, dispatched: 0, reconciled: 0, purged: 0 };
    }
    this.sweeping = true;
    try {
      const running = await this.rows.find({ where: { status: 'running' }, order: { updatedAt: 'ASC' }, take: SWEEP_BATCH });
      for (const row of running) {
        // One row's failure is not the sweep's: the rest of the batch, the
        // reconciler and the purge all still run.
        await this.guard(`poll ${row.id}`, () => this.poll(row, now));
      }
      const due = await this.rows.find({
        where: { status: 'queued', nextAttemptAt: LessThanOrEqual(now) },
        order: { nextAttemptAt: 'ASC' },
        take: SWEEP_BATCH,
      });
      for (const row of due) {
        await this.guard(`dispatch ${row.id}`, () => this.dispatch(row, now));
      }
      const reconciled = (await this.guard('reconcile', () => this.reconcile(), 0)) ?? 0;
      const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const purged = await this.rows.delete({ status: In(['succeeded', 'failed']), updatedAt: LessThan(cutoff) });
      return { polled: running.length, dispatched: due.length, reconciled, purged: purged.affected ?? 0 };
    } finally {
      this.sweeping = false;
    }
  }

  // Profiles that qualify for training, have no job at all, and have no
  // model: the state a lost enqueue leaves behind (the model service was
  // unreachable when the round was answered, the process died between the
  // ranking and the enqueue, or training was switched on after the rounds
  // were already ranked). Without this, such a profile waits for its next
  // completed round to land exactly on a threshold -- which, for a profile
  // that stopped ranking because nothing ever appeared, never comes. Paused
  // profiles are excluded (PRIVACY.md section 4), and a profile that has any
  // job row -- including a permanently failed one -- is not resurrected
  // here: a failure is the operator's to see, not something to loop on.
  async reconcile(limit = SWEEP_BATCH): Promise<number> {
    if (!this.client.enabled) {
      return 0;
    }
    const rows = await this.triads
      .createQueryBuilder('t')
      .select('t.profileId', 'profileId')
      .innerJoin('profiles', 'p', 'p.id = t."profileId" AND p."pausedAt" IS NULL')
      .where('t.status = :completed', { completed: 'completed' })
      .andWhere('t."countsTowardActivation" = true')
      .andWhere('NOT EXISTS (SELECT 1 FROM training_jobs j WHERE j."profileId" = t."profileId")')
      .andWhere('NOT EXISTS (SELECT 1 FROM user_model_snapshots s WHERE s."profileId" = t."profileId")')
      .groupBy('t.profileId')
      .having('COUNT(*) >= :threshold', { threshold: this.firstTriadCount })
      .limit(limit)
      .getRawMany<{ profileId: string }>();
    let enqueued = 0;
    for (const { profileId } of rows) {
      const { created } = await this.enqueue(profileId);
      if (created) {
        enqueued += 1;
        this.logger.log(`[training-jobs] reconciler enqueued profile ${profileId}: eligible, no job, no model`);
      }
    }
    return enqueued;
  }

  // Runs one step of the sweep so that a failure in it is reported rather
  // than either crashing the tick or vanishing.
  private async guard<T>(what: string, step: () => Promise<T>, fallback?: T): Promise<T | undefined> {
    try {
      return await step();
    } catch (error) {
      this.logger.error(`[training-jobs] ${what} failed: ${this.describe(error)}`);
      captureException(error, { stage: `training-jobs.${what.split(' ')[0]}` });
      return fallback;
    }
  }

  async summary(recent = 20): Promise<TrainingJobsSummary> {
    const counts: Record<TrainingJobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0 };
    for (const status of Object.keys(counts) as TrainingJobStatus[]) {
      counts[status] = await this.rows.count({ where: { status } });
    }
    const rows = await this.rows.find({ order: { createdAt: 'DESC' }, take: recent });
    return {
      counts,
      recent: rows.map((row) => ({
        id: row.id,
        profileId: row.profileId,
        status: row.status,
        attempts: row.attempts,
        errorKind: row.errorKind,
        lastError: row.lastError,
        nextAttemptAt: row.nextAttemptAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  // One dispatch attempt: ask the model service to start (or resume
  // tracking) this profile's training. A network-level failure here is
  // exactly as transient as a poll-time one, so it shares the same backoff.
  private async dispatch(row: TrainingJob, now: Date = new Date()): Promise<TrainingJob> {
    const claimed = await this.claim(row, now);
    if (!claimed) {
      // Another worker (or another tick) took this row between the read and
      // here. Not an error and not a retry: exactly one of us dispatches it.
      return row;
    }
    try {
      const job = await this.client.requestTraining(claimed.profileId);
      await this.rows.update({ id: claimed.id }, { modelServiceJobId: job.id });
      return { ...claimed, modelServiceJobId: job.id };
    } catch (error) {
      return this.retryOrFail(claimed, claimed.attempts, 'error', this.describe(error), now);
    }
  }

  // The lease. One statement -- UPDATE ... WHERE id = ? AND status =
  // 'queued' -- so two sweeps racing for the same row produce exactly one
  // winner, whatever process each runs in: the in-process `sweeping` flag
  // only ever guarded one replica, and the model service would have been
  // asked to fit the same profile twice. `startedAt` is stamped by every
  // claim because it is what the lease expires against (see poll()), not a
  // record of when the row was first tried -- `createdAt` is that.
  private async claim(row: TrainingJob, now: Date): Promise<TrainingJob | null> {
    const attempts = row.attempts + 1;
    const claimed = { status: 'running' as const, attempts, startedAt: now, modelServiceJobId: null };
    const result = await this.rows.update({ id: row.id, status: 'queued' }, claimed);
    return result.affected === 1 ? { ...row, ...claimed } : null;
  }

  // Read the model service's job the row is waiting on. Terminal states end
  // the row; 'queued'/'running' there just means "still working", checked
  // again next sweep tick; a lost job (null -- the service forgot it,
  // almost always a restart) is treated the same as a transient failure.
  private async poll(row: TrainingJob, now: Date): Promise<void> {
    if (!row.modelServiceJobId) {
      // Claimed, then nothing: the worker died between the claim and the
      // model service's answer. Until the lease expires the request may
      // still be in flight, so this waits rather than sending a second one.
      if (this.leaseExpired(row, now)) {
        await this.retryOrFail(row, row.attempts, 'error', 'The training attempt stopped before the model service accepted it', now);
      }
      return;
    }
    let job;
    try {
      job = await this.client.getJob(row.modelServiceJobId);
    } catch (error) {
      await this.retryOrFail(row, row.attempts, 'error', this.describe(error), now);
      return;
    }
    if (!job) {
      await this.retryOrFail(row, row.attempts, 'error', 'The model service no longer has this job (it may have restarted)', now);
      return;
    }
    if (job.status === 'queued' || job.status === 'running') {
      if (this.leaseExpired(row, now)) {
        await this.retryOrFail(
          row,
          row.attempts,
          'error',
          `The model service was still working on this job after ${Math.round(RUNNING_LEASE_MS / 60_000)} minutes`,
          now,
        );
      }
      return;
    }
    if (job.status === 'succeeded') {
      // .save(), not .update(): the json `result` column defeats
      // TypeORM's QueryDeepPartialEntity typing for .update() (no index
      // signature on the model service's own result shape), and this
      // branch already holds the full row.
      row.status = 'succeeded';
      row.finishedAt = now;
      row.result = (job.result as Record<string, unknown> | null) ?? null;
      row.errorKind = null;
      row.lastError = null;
      await this.rows.save(row);
      return;
    }
    // job.status === 'failed'. 'invalid' is deterministic -- the ranked
    // titles still lack fingerprints -- so retrying now changes nothing;
    // only 'error' (the model service's own failure) is worth another attempt.
    if (job.errorKind === 'invalid') {
      await this.rows.update(
        { id: row.id },
        { status: 'failed', finishedAt: now, errorKind: 'invalid', lastError: job.error ? sanitizeError(job.error) : null },
      );
      return;
    }
    await this.retryOrFail(row, row.attempts, 'error', job.error ?? 'Training failed', now);
  }

  private async retryOrFail(
    row: TrainingJob,
    attempts: number,
    errorKind: TrainingJobErrorKind,
    message: string,
    now: Date = new Date(),
  ): Promise<TrainingJob> {
    const lastError = sanitizeError(message);
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(`[training-jobs] ${row.id} (profile ${row.profileId}) failed after ${attempts} attempts: ${lastError}`);
      captureException(new Error(lastError), { trainingJobId: row.id, profileId: row.profileId });
      await this.rows.update({ id: row.id }, { status: 'failed', attempts, errorKind, lastError, finishedAt: now, modelServiceJobId: null });
      return { ...row, status: 'failed', attempts, errorKind, lastError, finishedAt: now };
    }
    const delay = BACKOFF_MS[attempts - 1];
    const nextAttemptAt = new Date(now.getTime() + delay);
    this.logger.warn(`[training-jobs] ${row.id} (profile ${row.profileId}) attempt ${attempts} failed, retry in ${Math.round(delay / 1000)}s: ${lastError}`);
    await this.rows.update(
      { id: row.id },
      { status: 'queued', attempts, errorKind, lastError, nextAttemptAt, modelServiceJobId: null },
    );
    return { ...row, status: 'queued', attempts, errorKind, lastError, nextAttemptAt, modelServiceJobId: null };
  }

  // `startedAt` is stamped on every claim; `updatedAt` covers a row written
  // before the column was used that way.
  private leaseExpired(row: TrainingJob, now: Date): boolean {
    const since = row.startedAt ?? row.updatedAt;
    return since ? now.getTime() - since.getTime() >= RUNNING_LEASE_MS : false;
  }

  private describe(error: unknown): string {
    if (error instanceof ModelServiceError) {
      return error.message;
    }
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === '23505';
  }
}
