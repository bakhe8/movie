import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, Not, QueryDeepPartialEntity, Repository } from 'typeorm';
import { AdminJob, AdminJobStatus } from '../../entities/admin-job.entity';
import { ContentFeature } from '../../entities/content-feature.entity';
import { Title } from '../../entities/title.entity';
import { FINGERPRINT_V2_DIMENSIONS, FINGERPRINT_V3_DIMENSIONS } from '../../entities/title-fingerprint.type';
import { captureException } from '../../observability/observability';
import { republishFingerprint } from '../../scripts/republish-fingerprint.lib';
import { sanitizeError } from '../training/training-jobs.service';
import type { Actor } from './admin-catalog.service';
import { AuditService } from '../audit/audit.service';
import { CreateAdminJobDto, ListAdminJobsQueryDto } from './dto/admin.dto';

// A unit of work reports progress and checks for a cooperative cancel
// between chunks; it never sees the row directly, so it cannot skip the
// bookkeeping (attempts, lease, sanitized errors) AdminJobsService owns.
export interface AdminJobRunContext {
  dryRun: boolean;
  reportProgress: (progress: Record<string, unknown>) => Promise<void>;
  isCancelled: () => Promise<boolean>;
}

export type AdminJobHandler = (params: Record<string, unknown>, ctx: AdminJobRunContext) => Promise<Record<string, unknown>>;

// A handler throws this instead of a plain Error to mean "this attempt's
// outcome is deterministic -- retrying without new input changes nothing"
// (the same distinction training_jobs draws between its 'invalid' and
// 'error' kinds). AdminJobsService fails the job at once, skipping the
// backoff ladder, instead of burning MAX_ATTEMPTS on a certain repeat.
export class NonRetryableJobError extends Error {}

export interface AdminJobTypeDef {
  key: string;
  // Plain-language description the frontend shows next to the type in the
  // registration form -- admin-copy.ts's discipline extends to this list.
  description: string;
  handler: AdminJobHandler;
  // Optional: returns an error message when `params` is unusable for this
  // type (checked in create(), before the row is even written), or null
  // when it is fine. Keeps each type's own shape out of the shared DTO
  // without pulling in a schema-validation library for one dynamic field.
  validateParams?: (params: Record<string, unknown>) => string | null;
}

// `params` is a caller-controlled bag (CreateAdminJobDto.params has no key
// allowlist -- each type's own validateParams checks shape, not names), and
// it is echoed into the audit log's free-text `reason` for a human to read
// what a job was asked to do. A key that merely *looks* like a credential is
// blanked before that -- same defence-in-depth spirit as sanitizeError()
// (training-jobs.service.ts), applied to keys instead of a message string,
// since job params are a structured object, not free text.
const SENSITIVE_PARAM_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|connection[-_]?string/i;

function redactSensitiveParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    redacted[key] = SENSITIVE_PARAM_KEY.test(key) ? '[redacted]' : value;
  }
  return redacted;
}

// The same redaction, applied to what list()/get()/create() hand back over
// HTTP (W8 secrets audit: "no secrets in the response", not just the log).
// The row stored in the database, and what dispatch() passes to the
// handler, are never touched here -- a handler that legitimately needs a
// credential-shaped param still gets the real value.
function toPublicView(row: AdminJob): AdminJob {
  if (!row.params) {
    return row;
  }
  return { ...row, params: redactSensitiveParams(row.params) };
}

const BACKOFF_MS = [5_000, 30_000, 120_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
const SWEEP_BATCH = 10;
const RETENTION_DAYS = 30;
// The lease a claim holds before the sweep reclaims it as stuck. Sized for
// in-process DB work (republish_fingerprints scans the whole catalogue in
// well under a second) -- a future handler that does real I/O (a network
// catalogue pull, say) MUST call `ctx.reportProgress` at least once every
// 60 seconds of real work: every reportProgress call is a plain `UPDATE`,
// which bumps `updatedAt` and so extends the lease for free. A handler that
// goes quiet for RUNNING_LEASE_MS is indistinguishable from a crashed one
// and will be reclaimed and retried out from under it.
const RUNNING_LEASE_MS = 5 * 60 * 1000;
const PROGRESS_CHECKPOINT = 25;

// ADMIN-W5 (plan §17.2, §18 W5): the one durable task queue behind every
// allowlisted admin job. `create()` writes the row then fires `dispatch()`
// without awaiting it -- the HTTP response returns the queued row at once,
// the caller polls `get()` for progress/result, matching the durable-queue
// pattern `training_jobs` established (ADR-100) rather than a synchronous
// long-running request. Unlike training_jobs, a handler here runs entirely
// in-process (no external service to poll), so `dispatch()` both claims and
// executes the unit of work in one step.
@Injectable()
export class AdminJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminJobsService.name);
  readonly sweepIntervalMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  // Mutable so other modules can extend the allowlist via registerType()
  // (item 9/J1-1) without editing this file -- AdminModule exports this
  // service for exactly that.
  private readonly handlers = new Map<string, AdminJobTypeDef>();

  constructor(
    @InjectRepository(AdminJob)
    private readonly rows: Repository<AdminJob>,
    @InjectRepository(Title)
    private readonly titles: Repository<Title>,
    @InjectRepository(ContentFeature)
    private readonly features: Repository<ContentFeature>,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    const raw = Number(config.get<string>('ADMIN_JOBS_SWEEP_INTERVAL_MS'));
    this.sweepIntervalMs = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SWEEP_INTERVAL_MS;
    this.registerType({
      key: 'republish_fingerprints',
      description:
        'يعيد نشر بصمة الفيلم من أحدث تحليل معتمد (content_features غير المُستبدَلة) على كل الأفلام، أو فيلم واحد إن حُدِّد titleId. لا يخترع قيمة، ولا يمس فيلماً بلا بصمة منشورة أصلاً.',
      handler: (params, ctx) => this.republishFingerprintsHandler(params, ctx),
      validateParams: (params) => (params.titleId !== undefined && typeof params.titleId !== 'string' ? 'titleId must be a string' : null),
    });
  }

  // The extension point other modules register their own allowlisted types
  // through (item 9/J1-1): inject AdminJobsService and call this from your
  // own module's constructor or onModuleInit. Throws on a duplicate key --
  // two modules silently racing to own the same type name is a deploy-time
  // bug, not something to resolve by last-write-wins.
  registerType(def: AdminJobTypeDef): void {
    if (this.handlers.has(def.key)) {
      throw new Error(`admin job type '${def.key}' is already registered`);
    }
    this.handlers.set(def.key, def);
  }

  // Disabled under test so suites drive runDue() by hand; disabled with
  // ADMIN_JOBS_SWEEP_INTERVAL_MS=0 when an external scheduler owns it.
  onModuleInit(): void {
    if (this.sweepIntervalMs === 0 || this.config.get<string>('NODE_ENV') === 'test') {
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.runDue().catch((error: unknown) => {
        this.logger.error(`admin-jobs sweep failed: ${this.describe(error)}`);
        captureException(error, { stage: 'admin-jobs.sweep' });
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

  // The allowlist itself, for the registration form -- never a free-text
  // job-type input on the frontend.
  listTypes(): { type: string; description: string }[] {
    return [...this.handlers.values()].map((def) => ({ type: def.key, description: def.description }));
  }

  // `actor` is null for a schedule-triggered call (item 1/9: a future
  // internal caller with no signed-in admin behind it) -- the controller
  // always passes a real Actor; only another service calling this directly
  // would pass null.
  async create(dto: CreateAdminJobDto, actor: Actor | null): Promise<{ job: AdminJob; created: boolean }> {
    const def = this.handlers.get(dto.type);
    if (!def) {
      throw new ConflictException({
        statusCode: 409,
        message: `Unknown job type '${dto.type}'`,
        error: 'Conflict',
        reason: 'unknown_type',
        allowlist: [...this.handlers.keys()],
      });
    }
    if (def.validateParams) {
      const paramsError = def.validateParams(dto.params ?? {});
      if (paramsError) {
        throw new BadRequestException({ statusCode: 400, message: paramsError, error: 'Bad Request', reason: 'invalid_params' });
      }
    }
    if (dto.idempotencyKey) {
      const existing = await this.rows.findOne({ where: { idempotencyKey: dto.idempotencyKey } });
      if (existing) {
        return { job: existing, created: false };
      }
    }
    // Item 5: one non-terminal job per type. This read is a courtesy for a
    // clear error message; IDX_admin_jobs_one_active_per_type is what
    // actually closes the race between two concurrent creates (caught
    // below).
    const busy = await this.rows.findOne({ where: { type: dto.type, status: In(['queued', 'running']) } });
    if (busy) {
      throw new ConflictException({
        statusCode: 409,
        message: `A '${dto.type}' job is already ${busy.status}`,
        error: 'Conflict',
        reason: 'type_busy',
        existingJobId: busy.id,
      });
    }

    let row: AdminJob;
    try {
      row = await this.rows.save(
        this.rows.create({
          type: dto.type,
          status: 'queued',
          params: dto.params ?? null,
          dryRun: dto.dryRun ?? false,
          attempts: 0,
          nextAttemptAt: new Date(),
          requestedBy: actor?.id ?? null,
          trigger: actor ? 'admin' : 'schedule',
          idempotencyKey: dto.idempotencyKey ?? null,
        }),
      );
    } catch (error) {
      // Item 2: two concurrent creates raced past the reads above -- one of
      // the two partial unique indexes (idempotencyKey or one-active-per-
      // type) refused the loser's INSERT. Same recovery training_jobs.
      // enqueue() uses: the winner's row already exists, hand it back
      // instead of surfacing a raw 500.
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      const winner = dto.idempotencyKey
        ? await this.rows.findOne({ where: { idempotencyKey: dto.idempotencyKey } })
        : await this.rows.findOne({ where: { type: dto.type, status: In(['queued', 'running']) } });
      if (!winner) {
        throw error;
      }
      if (!dto.idempotencyKey) {
        throw new ConflictException({
          statusCode: 409,
          message: `A '${dto.type}' job is already ${winner.status}`,
          error: 'Conflict',
          reason: 'type_busy',
          existingJobId: winner.id,
        });
      }
      return { job: winner, created: false };
    }

    await this.audit.record({
      actorUserId: actor?.id ?? null,
      actorRole: actor?.role ?? 'system',
      action: 'admin.job.create',
      resource: 'admin_job',
      resourceId: row.id,
      status: 'ok',
      reason: `${dto.type}${dto.dryRun ? ' (dry run)' : ''}${dto.params ? ` params=${JSON.stringify(redactSensitiveParams(dto.params))}` : ''}`,
      ip: actor?.ip ?? null,
    });
    void this.dispatch(row).catch((error: unknown) => {
      this.logger.error(`admin-jobs dispatch ${row.id} failed: ${this.describe(error)}`);
      captureException(error, { stage: 'admin-jobs.dispatch', adminJobId: row.id });
    });
    return { job: toPublicView(row), created: true };
  }

  async list(query: ListAdminJobsQueryDto) {
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status as AdminJobStatus } : {}),
    };
    const [items, total] = await this.rows.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items: items.map(toPublicView), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) };
  }

  async get(id: string): Promise<AdminJob> {
    const row = await this.rows.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Job not found');
    }
    return toPublicView(row);
  }

  // Cancelling a queued row ends it at once (it never ran); cancelling a
  // running one is cooperative -- the flag is set, and the handler's own
  // checkpoint (isCancelled) stops it and dispatch() records the final
  // 'cancelled' status once it does. A terminal row cannot be cancelled.
  async cancel(id: string, actor: Actor): Promise<AdminJob> {
    const row = await this.get(id);
    if (row.status === 'queued') {
      await this.rows.update({ id, status: 'queued' }, { status: 'cancelled', finishedAt: new Date() });
    } else if (row.status === 'running') {
      await this.rows.update({ id }, { cancelRequested: true });
    } else {
      throw new ConflictException({ statusCode: 409, message: `Job already ${row.status}`, error: 'Conflict', reason: 'already_terminal' });
    }
    await this.audit.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'admin.job.cancel',
      resource: 'admin_job',
      resourceId: id,
      status: 'ok',
      reason: `was ${row.status}`,
      ip: actor.ip,
    });
    return this.get(id);
  }

  // Reclaims a stuck 'running' row past its lease, dispatches any 'queued'
  // row whose backoff elapsed (the fire-and-forget dispatch in create() can
  // be lost to a process restart between the write and the call), then
  // purges old terminal rows. Also callable directly (tests).
  async runDue(now: Date = new Date()): Promise<{ reclaimed: number; dispatched: number; purged: number }> {
    if (this.sweeping) {
      return { reclaimed: 0, dispatched: 0, purged: 0 };
    }
    this.sweeping = true;
    try {
      const stuck = await this.rows.find({
        where: { status: 'running', updatedAt: LessThan(new Date(now.getTime() - RUNNING_LEASE_MS)) },
        take: SWEEP_BATCH,
      });
      let reclaimed = 0;
      for (const row of stuck) {
        await this.guard(`reclaim ${row.id}`, async () => {
          await this.retryOrFail(row, row.attempts, 'The job stopped responding (process likely restarted)', now);
          reclaimed += 1;
        });
      }
      const due = await this.rows.find({
        where: { status: 'queued', nextAttemptAt: LessThanOrEqual(now) },
        order: { nextAttemptAt: 'ASC' },
        take: SWEEP_BATCH,
      });
      // Item 4: not awaited -- a slow handler (a future network-bound job
      // type) must not hold up every other due job behind it in this batch.
      // Each dispatch still claims its own row exclusively, so firing them
      // concurrently is exactly as safe as one at a time, just not
      // serialized for no reason.
      for (const row of due) {
        void this.guard(`dispatch ${row.id}`, () => this.dispatch(row, now));
      }
      const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const purged = await this.rows.delete({ status: 'succeeded', updatedAt: LessThan(cutoff) });
      return { reclaimed, dispatched: due.length, purged: purged.affected ?? 0 };
    } finally {
      this.sweeping = false;
    }
  }

  private async guard(what: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.logger.error(`[admin-jobs] ${what} failed: ${this.describe(error)}`);
      captureException(error, { stage: `admin-jobs.${what.split(' ')[0]}` });
    }
  }

  // The lease: one statement, `UPDATE ... WHERE id = ? AND status = 'queued'`
  // -- two callers racing for the same row (the create()-time dispatch and a
  // sweep tick) produce exactly one winner, in whatever process each runs in.
  private async claim(row: AdminJob, now: Date): Promise<AdminJob | null> {
    const attempts = row.attempts + 1;
    const claimed = { status: 'running' as const, attempts, startedAt: now, cancelRequested: false };
    const result = await this.rows.update({ id: row.id, status: 'queued' }, claimed);
    return result.affected === 1 ? { ...row, ...claimed } : null;
  }

  private async dispatch(row: AdminJob, now: Date = new Date()): Promise<void> {
    const claimed = await this.claim(row, now);
    if (!claimed) {
      return;
    }
    const def = this.handlers.get(claimed.type);
    if (!def) {
      // The row was created under an allowlist that has since dropped this
      // type (a deploy removed a handler) -- fail it visibly rather than
      // loop forever.
      await this.rows.update({ id: claimed.id }, { status: 'failed', finishedAt: new Date(), lastError: `Unknown type '${claimed.type}'` });
      return;
    }
    const ctx: AdminJobRunContext = {
      dryRun: claimed.dryRun,
      reportProgress: async (progress) => {
        await this.rows.update({ id: claimed.id }, { progress } as unknown as QueryDeepPartialEntity<AdminJob>);
      },
      isCancelled: async () => {
        const fresh = await this.rows.findOne({ where: { id: claimed.id }, select: { cancelRequested: true } });
        return fresh?.cancelRequested ?? false;
      },
    };
    try {
      const result = await def.handler(claimed.params ?? {}, ctx);
      const cancelled = await ctx.isCancelled();
      await this.rows.update(
        { id: claimed.id },
        { status: cancelled ? 'cancelled' : 'succeeded', result, finishedAt: new Date(), lastError: null } as unknown as QueryDeepPartialEntity<AdminJob>,
      );
    } catch (error) {
      if (error instanceof NonRetryableJobError) {
        await this.rows.update({ id: claimed.id }, { status: 'failed', attempts: claimed.attempts, lastError: sanitizeError(error.message), finishedAt: new Date() });
        return;
      }
      await this.retryOrFail(claimed, claimed.attempts, this.describe(error), now);
    }
  }

  private async retryOrFail(row: AdminJob, attempts: number, message: string, now: Date): Promise<void> {
    const lastError = sanitizeError(message);
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(`[admin-jobs] ${row.id} (${row.type}) failed after ${attempts} attempts: ${lastError}`);
      captureException(new Error(lastError), { adminJobId: row.id, jobType: row.type });
      await this.rows.update({ id: row.id }, { status: 'failed', attempts, lastError, finishedAt: now });
      return;
    }
    const delay = BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    await this.rows.update(
      { id: row.id },
      { status: 'queued', attempts, lastError, nextAttemptAt: new Date(now.getTime() + delay) },
    );
  }

  private describe(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === '23505';
  }

  // The first allowlisted type (plan §17.2, item 1): folds every current,
  // non-superseded content_features row back onto the title's published
  // fingerprint, exactly the standalone republish-fingerprint.ts script's
  // logic, now behind dry-run/progress/cancel/audit instead of a CLI a human
  // has to remember to run.
  private async republishFingerprintsHandler(params: Record<string, unknown>, ctx: AdminJobRunContext): Promise<Record<string, unknown>> {
    const titleId = typeof params.titleId === 'string' ? params.titleId : undefined;
    const candidates = await this.titles.find({
      where: { fingerprint: Not(IsNull()), ...(titleId ? { id: titleId } : {}) },
    });
    let processed = 0;
    let titlesChanged = 0;
    let keysChanged = 0;
    const sample: { titleId: string; internalId: string; changes: unknown }[] = [];
    for (const title of candidates) {
      if (processed % PROGRESS_CHECKPOINT === 0 && (await ctx.isCancelled())) {
        break;
      }
      const currentRows = await this.features.find({ where: { titleId: title.id, supersededBy: IsNull() } });
      const { fingerprint, changes } = republishFingerprint(
        title.fingerprint as unknown as Record<string, unknown>,
        currentRows.map((row) => ({ featureKey: row.featureKey, value: row.value, uncertainty: row.uncertainty })),
        FINGERPRINT_V2_DIMENSIONS,
        FINGERPRINT_V3_DIMENSIONS,
      );
      processed += 1;
      if (changes.length > 0) {
        titlesChanged += 1;
        keysChanged += changes.length;
        if (!ctx.dryRun) {
          await this.titles.update(title.id, { fingerprint: fingerprint as unknown as Title['fingerprint'] });
        }
        if (sample.length < 20) {
          sample.push({ titleId: title.id, internalId: title.internalId, changes });
        }
      }
      if (processed % PROGRESS_CHECKPOINT === 0) {
        await ctx.reportProgress({ processed, total: candidates.length, titlesChanged, keysChanged });
      }
    }
    await ctx.reportProgress({ processed, total: candidates.length, titlesChanged, keysChanged });
    return { scanned: candidates.length, processed, titlesChanged, keysChanged, sample };
  }
}
